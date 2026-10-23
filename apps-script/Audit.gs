/**
 * Audit.gs — Nhật ký thao tác và nhật ký thao tác nhiều bước (OPERATIONS).
 */

/**
 * Ghi nhật ký. Dùng appendRow (ghi thêm nguyên tử phía Sheets) nên an toàn khi không giữ khóa.
 * detail chỉ là mô tả ngắn — KHÔNG đưa OTP, token, số giấy tờ, địa chỉ… vào đây.
 */
function audit_(ctx, action, objType, objId, result, requestId, detail) {
  try {
    var t = table_('AUDIT_LOGS');
    var obj = {
      log_id: newId_('LOG'), at: now_(), actor: ctx && ctx.user ? ctx.user.email : 'anonymous',
      action: action, object_type: objType || '', object_id: objId || '', result: result || 'OK',
      request_id: requestId || '', detail: String(detail || '').substring(0, 200)
    };
    sheet_('AUDIT_LOGS').appendRow(objToLine_(t, obj));
    invalidate_('AUDIT_LOGS');
  } catch (e) {
    console.error('Không ghi được nhật ký: ' + (e && e.message));
  }
}

function auditList_(ctx, p) {
  assertAdmin_(ctx);
  var all = rows_('AUDIT_LOGS');
  var q = normalizeText_(p && p.q);
  var list = all.filter(function (r) {
    if (p && p.result && r.result !== p.result) return false;
    if (!q) return true;
    return normalizeText_(r.actor + ' ' + r.action + ' ' + r.object_id + ' ' + r.detail).indexOf(q) >= 0;
  }).reverse();
  return paginate_(list, p, function (r) { return plain_(r); });
}

/* ================== Chống xử lý lặp + nhật ký nhiều bước ================== */

/**
 * Thực hiện một thao tác ghi với request_id:
 *  - Nếu request_id (của cùng người dùng) đã DONE → trả lại kết quả cũ, KHÔNG làm lại.
 *  - Nếu đang STARTED → báo đang xử lý.
 *  - Ghi dòng OPERATIONS trạng thái STARTED kèm params để phục hồi, chạy fn, rồi đánh dấu DONE.
 *  - Nếu fn lỗi nghiệp vụ → FAILED (không có thay đổi dở dang vì kiểm tra hợp lệ được làm trước khi ghi).
 *  - Nếu tiến trình bị dừng giữa chừng (hết thời gian, mất kết nối…) → dòng vẫn STARTED,
 *    quản trị dùng "Phục hồi thao tác dở dang" để chạy lại các bước (các bước đều lũy đẳng).
 * Phải gọi bên trong withLock_.
 */
function runOperation_(ctx, requestId, action, params, fn) {
  if (!requestId || !/^[A-Za-z0-9-]{8,64}$/.test(requestId)) {
    throw AppError_(ERR.VALIDATION, 'Thiếu mã thao tác. Hãy tải lại trang rồi thử lại.');
  }
  var existing = null;
  var ops = rows_('OPERATIONS');
  for (var i = ops.length - 1; i >= 0; i--) {
    if (ops[i].request_id === requestId && ops[i].actor_user_id === ctx.user.user_id) { existing = ops[i]; break; }
  }
  if (existing) {
    if (existing.action !== action) throw AppError_(ERR.CONFLICT, 'Mã thao tác đã được dùng cho việc khác. Hãy tải lại trang.');
    if (existing.status === 'DONE' || existing.status === 'RECOVERED') {
      var prev = safeJson_(existing.result_json, {});
      prev._replayed = true;
      return prev;
    }
    if (existing.status === 'STARTED') throw AppError_(ERR.CONFLICT, 'Thao tác này đang được xử lý hoặc bị gián đoạn. Vui lòng đợi rồi tải lại trang; nếu vẫn lỗi, báo quản trị.');
    // FAILED: cho phép thử lại với cùng request_id
  }
  var op = {
    op_id: newId_('OP'), request_id: requestId, actor_user_id: ctx.user.user_id, action: action,
    status: 'STARTED', started_at: now_(), finished_at: '', params_json: params ? JSON.stringify(params) : '',
    result_json: '', error: ''
  };
  insertRow_('OPERATIONS', op);
  try {
    var result = fn(op);
    op.status = 'DONE'; op.finished_at = now_();
    op.result_json = JSON.stringify(result || {});
    if (op.result_json.length > 40000) op.result_json = JSON.stringify({ ok: true, truncated: true });
    updateRow_('OPERATIONS', op);
    return result;
  } catch (e) {
    if (e && e.__fault) throw e; // lỗi giả lập trong kiểm thử: để nguyên STARTED
    op.status = 'FAILED'; op.finished_at = now_();
    op.error = String(e && e.message || e).substring(0, 300);
    try { updateRow_('OPERATIONS', op); } catch (e2) { }
    throw e;
  }
}

/** Điểm chèn lỗi cho kiểm thử phục hồi (chỉ có tác dụng khi biến toàn cục __FAULT được đặt bởi bộ kiểm thử). */
function faultPoint_(name) {
  if (typeof __FAULT !== 'undefined' && __FAULT === name) {
    var e = new Error('Lỗi giả lập tại ' + name);
    e.__fault = true;
    throw e;
  }
}

/** Danh sách thao tác dở dang (STARTED quá APP.OP_STALE_MIN phút). */
function pendingOperations_() {
  return rows_('OPERATIONS').filter(function (o) {
    return o.status === 'STARTED' && minutesSince_(o.started_at) >= APP.OP_STALE_MIN;
  });
}

/** Các thao tác nhiều bước có thể phục hồi: action → hàm chạy lại các bước (lũy đẳng). */
var RECOVERABLE = {
  'change.approve': function (params, actorEmail) { return applyChange_(params, actorEmail); },
  'transfer.confirm': function (params, actorEmail) { return applyTransfer_(params, actorEmail); }
};

function recoverOperations_(ctx, requestId) {
  return withLock_(function () {
    var list = pendingOperations_();
    var out = [];
    list.forEach(function (op) {
      var fn = RECOVERABLE[op.action];
      var params = safeJson_(op.params_json, null);
      try {
        if (fn && params) {
          var actor = findBy_('USERS', 'user_id', op.actor_user_id);
          var res = fn(params, actor ? actor.email : 'recovery');
          op.status = 'RECOVERED'; op.result_json = JSON.stringify(res || {});
        } else {
          // Thao tác một bước: nếu đã STARTED mà không DONE thì chưa có ghi dữ liệu nghiệp vụ hoặc đã ghi đủ trong 1 lần.
          op.status = 'FAILED'; op.error = 'Bị gián đoạn; thao tác một bước, người dùng cần kiểm tra và thực hiện lại.';
        }
      } catch (e) {
        op.status = 'FAILED'; op.error = 'Phục hồi lỗi: ' + String(e && e.message || e).substring(0, 250);
      }
      op.finished_at = now_();
      updateRow_('OPERATIONS', op);
      out.push({ op_id: op.op_id, action: op.action, status: op.status, error: op.error });
    });
    audit_(ctx, 'RECOVER_OPERATIONS', 'SYSTEM', '', 'OK', requestId, 'Số thao tác: ' + out.length);
    return { items: out };
  });
}

/** Ghi lịch sử xử lý yêu cầu. */
function approvalAction_(targetType, targetId, action, actor, note, requestId) {
  insertRow_('APPROVAL_ACTIONS', {
    action_id: newId_('ACT'), target_type: targetType, target_id: targetId, action: action,
    actor: actor, at: now_(), note: note || '', request_id: requestId || ''
  });
}

/** Phân trang dùng chung. */
function paginate_(list, p, mapFn) {
  var size = Math.min(Math.max(parseInt(p && p.pageSize, 10) || APP.PAGE_SIZE_DEFAULT, 1), APP.PAGE_SIZE_MAX);
  var total = list.length;
  var pages = Math.max(1, Math.ceil(total / size));
  var page = Math.min(Math.max(parseInt(p && p.page, 10) || 1, 1), pages);
  var items = list.slice((page - 1) * size, page * size).map(mapFn || function (x) { return x; });
  return { items: items, total: total, page: page, pages: pages, pageSize: size };
}
