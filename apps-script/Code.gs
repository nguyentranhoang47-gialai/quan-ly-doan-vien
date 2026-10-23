/**
 * Code.gs — Điểm vào của Web App.
 *
 * KIẾN TRÚC: Giao diện nghiệp vụ do Apps Script HTML Service phục vụ (doGet) và gọi máy chủ
 * bằng google.script.run.api(...). Trang GitHub Pages chỉ là trang giới thiệu có nút mở Web App.
 *
 * HÀM CÔNG KHAI (gọi được từ trình duyệt): doGet, api.
 * Các hàm chạy từ trình soạn thảo (setupSystem, installDailyBackup, ...) tự kiểm tra ngữ cảnh chủ sở hữu.
 * Mọi hàm còn lại kết thúc bằng "_" nên google.script.run KHÔNG gọi được.
 */

function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  return t.evaluate()
    .setTitle(APP.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT); // không cho trang khác nhúng (chống clickjacking)
}

/** Dùng trong Index.html: <?!= include_('Styles') ?> — chỉ chèn tệp tĩnh của dự án. */
function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * Bảng hành động: name → [hàm, cần đăng nhập?, là thao tác ghi (cần request_id)?]
 * Hàm đọc nhận (ctx, payload); hàm ghi nhận (ctx, payload, requestId).
 * Tạo trong hàm (không phải biến toàn cục) vì Apps Script nạp các tệp .gs theo thứ tự,
 * hàm ở tệp sau chưa tồn tại khi mã cấp cao nhất của tệp trước chạy.
 */
function actions_() {
  return {
  'auth.requestOtp': [function (ctx, p, rid) { return authRequestOtp_(p, rid); }, false, false],
  'auth.verifyOtp': [function (ctx, p, rid) { return authVerifyOtp_(p, rid); }, false, false],
  'auth.logout': [authLogout_, true, false],
  'me': [function (ctx) { return describeAccess_(ctx); }, true, false],
  'dashboard': [dashboard_, true, false],

  'members.list': [membersList_, true, false],
  'members.get': [memberGet_, true, false],

  'change.save': [crSave_, true, true],
  'change.submit': [crSubmit_, true, true],
  'change.cancel': [crCancel_, true, true],
  'change.list': [crList_, true, false],
  'change.get': [crGet_, true, false],
  'change.approve': [crApprove_, true, true],
  'change.approveMany': [crApproveMany_, true, true],
  'change.return': [crReturn_, true, true],

  'transfer.create': [trCreate_, true, true],
  'transfer.list': [trList_, true, false],
  'transfer.confirm': [function (c, p, r) { return trDecide_(c, p, r, 'confirm'); }, true, true],
  'transfer.reject': [function (c, p, r) { return trDecide_(c, p, r, 'reject'); }, true, true],
  'transfer.cancel': [function (c, p, r) { return trDecide_(c, p, r, 'cancel'); }, true, true],

  'dues.list': [duesList_, true, false],
  'dues.record': [duesRecord_, true, true],
  'dues.adjust': [duesAdjust_, true, true],
  'dues.history': [duesHistoryList_, true, false],
  'dues.summary': [duesSummary_, true, false],

  'import.check': [importCheck_, true, false],
  'import.commit': [importCommit_, true, true],
  'import.jobs': [importJobs_, true, false],
  'export.members': [exportMembers_, true, true],
  'export.report': [exportReport_, true, true],
  'report.byUnit': [reportByUnit_, true, false],

  'admin.overview': [adminOverview_, true, false],
  'admin.unitSave': [unitSave_, true, true],
  'admin.userSave': [userSave_, true, true],
  'admin.scopeAdd': [scopeAdd_, true, true],
  'admin.scopeRemove': [scopeRemove_, true, true],
  'admin.revokeSessions': [revokeSessionsApi_, true, true],
  'admin.settingsSave': [settingsSave_, true, true],
  'admin.audit': [auditList_, true, false],
  'admin.backupList': [backupList_, true, false],
  'admin.backupNow': [backupNowApi_, true, true],
  'admin.restore': [restoreApi_, true, true],
  'admin.recover': [function (c, p, r) { assertAdmin_(c); return recoverOperations_(c, r); }, true, true]
  };
}

/**
 * Hàm công khai duy nhất cho giao diện.
 * req = { token, action, payload, requestId }
 * Trả về { ok: true, data } hoặc { ok: false, error: { code, message, details } }.
 */
function api(req) {
  var action = req && typeof req.action === 'string' ? req.action : '';
  var requestId = req && typeof req.requestId === 'string' ? req.requestId.substring(0, 64) : '';
  var ACTIONS = actions_();
  var def = ACTIONS.hasOwnProperty(action) ? ACTIONS[action] : null;
  try {
    if (!def) throw AppError_(ERR.VALIDATION, 'Chức năng không tồn tại. Hãy tải lại trang.');
    var payload = req.payload && typeof req.payload === 'object' ? req.payload : {};
    if (JSON.stringify(payload).length > 2000000) throw AppError_(ERR.VALIDATION, 'Dữ liệu gửi lên quá lớn. Hãy chia nhỏ tệp.');
    var ctx = null;
    if (def[1]) {
      ctx = authenticate_(req.token);
      ctx.requestId = requestId;
    }
    if (def[2] && !requestId) throw AppError_(ERR.VALIDATION, 'Thiếu mã thao tác. Hãy tải lại trang rồi thử lại.');
    var data = def[0](ctx, payload, requestId);
    return { ok: true, data: data === undefined ? null : data };
  } catch (e) {
    if (e && e.appCode) {
      return { ok: false, error: { code: e.appCode, message: e.message, details: e.details || null } };
    }
    var ref = randomHex_(8).toUpperCase();
    // Log kỹ thuật: chỉ ghi tên hành động, mã tham chiếu và thông điệp lỗi — không ghi payload/token.
    console.error('[' + ref + '] ' + action + ': ' + (e && e.stack ? e.stack : e));
    return { ok: false, error: { code: ERR.INTERNAL, message: 'Có lỗi hệ thống. Vui lòng thử lại; nếu vẫn lỗi, báo quản trị kèm mã ' + ref + '.' } };
  }
}
