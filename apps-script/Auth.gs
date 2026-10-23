/**
 * Auth.gs — Đăng nhập bằng mã OTP gửi qua email và quản lý phiên.
 *
 *  - Chỉ email có trong USERS (status=active) mới nhận được mã.
 *  - Thông báo công khai giống nhau dù email có tồn tại hay không.
 *  - OTP 6 chữ số sinh từ UUID (SecureRandom), chỉ lưu HMAC-SHA256 (khóa AUTH_PEPPER).
 *  - Token phiên 256 bit, chỉ lưu HMAC; được xác minh lại ở MỌI lần gọi api().
 *  - Khóa tài khoản / thu hồi phiên có hiệu lực ngay ở lần gọi tiếp theo.
 */

var GENERIC_OTP_MSG = 'Nếu email này đã được cấp quyền, mã đăng nhập đã được gửi tới hộp thư. Mã có hiệu lực 5 phút. ' +
  'Nếu không thấy, hãy kiểm tra thư mục Spam hoặc liên hệ quản trị.';
var GENERIC_VERIFY_FAIL = 'Mã không đúng hoặc đã hết hạn. Hãy kiểm tra lại mã hoặc bấm "Gửi lại mã".';

function normEmail_(e) { return String(e || '').trim().toLowerCase(); }
function validEmail_(e) { return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(e) && e.length <= 120; }

function generateOtp_() {
  // 8 ký tự hex = 32 bit ngẫu nhiên → 6 chữ số (sai lệch phân phối không đáng kể).
  var n = parseInt(randomHex_(8), 16) % 1000000;
  return ('000000' + n).slice(-6);
}

/** Bộ đếm tần suất dùng CacheService (gọi khi đang giữ khóa). */
function bumpCounter_(key, ttlSec) {
  var cache = CacheService.getScriptCache();
  var n = parseInt(cache.get(key) || '0', 10) + 1;
  cache.put(key, String(n), ttlSec);
  return n;
}

function authRequestOtp_(payload, requestId) {
  var email = normEmail_(payload && payload.email);
  if (!validEmail_(email)) throw AppError_(ERR.VALIDATION, 'Email chưa đúng định dạng. Ví dụ đúng: ten@coquan.vn');

  // Kiểm tra hạn mức gửi thư TRƯỚC khi tra cứu email để không làm lộ email có tồn tại hay không.
  var quota = 0;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { quota = 0; }
  if (quota < 1) {
    audit_(null, 'OTP_QUOTA_EXHAUSTED', 'AUTH', '', 'ERROR', requestId, 'Hết hạn mức gửi email trong ngày');
    throw AppError_(ERR.RATE_LIMIT, 'Hệ thống đã hết lượt gửi email trong hôm nay. Vui lòng thử lại sau 0 giờ hoặc báo quản trị.');
  }

  var emailHash = hmac_('email:' + email);
  var toSend = withLock_(function () {
    var hourBucket = Utilities.formatDate(new Date(), APP.TZ, 'yyyyMMddHH');
    var g = bumpCounter_('otp:g:' + hourBucket, 3600);
    if (g > APP.OTP_GLOBAL_PER_HOUR) {
      audit_(null, 'OTP_GLOBAL_LIMIT', 'AUTH', '', 'DENIED', requestId, '');
      throw AppError_(ERR.RATE_LIMIT, 'Có quá nhiều yêu cầu gửi mã trong giờ này. Vui lòng thử lại sau ít phút.');
    }
    var perEmail = bumpCounter_('otp:e:' + emailHash, 15 * 60);
    if (perEmail > APP.OTP_PER_EMAIL_15MIN) {
      // Áp dụng cho mọi email (kể cả không tồn tại) để không lộ thông tin.
      throw AppError_(ERR.RATE_LIMIT, 'Bạn đã yêu cầu mã quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại.');
    }
    var user = findBy_('USERS', 'email', email);
    if (!user || user.status !== 'active') {
      audit_(null, 'OTP_REQUEST', 'AUTH', '', 'DENIED', requestId, 'Email không được cấp quyền');
      return null;
    }
    // Vô hiệu các mã cũ chưa dùng của email này
    var olds = rows_('AUTH_OTP').filter(function (o) { return o.email_hash === emailHash && !o.used; });
    olds.forEach(function (o) { o.used = true; });
    updateRows_('AUTH_OTP', olds);
    var otp = generateOtp_();
    var otpId = newId_('OTP');
    insertRow_('AUTH_OTP', {
      otp_id: otpId, email_hash: emailHash, otp_hash: hmac_('otp:' + otpId + ':' + otp),
      created_at: now_(), expires_at: addMinutes_(now_(), APP.OTP_TTL_MIN), attempts: 0, used: false
    });
    audit_({ user: user }, 'OTP_REQUEST', 'AUTH', user.user_id, 'OK', requestId, '');
    return { email: email, otp: otp, otpId: otpId };
  });

  // Gửi email NGOÀI khóa.
  if (toSend) {
    var org = getSetting_('ORG_NAME', APP.NAME);
    try {
      MailApp.sendEmail({
        to: toSend.email,
        subject: 'Mã đăng nhập ' + APP.NAME,
        body: 'Mã đăng nhập của bạn là: ' + toSend.otp + '\n\nMã có hiệu lực trong ' + APP.OTP_TTL_MIN +
          ' phút và chỉ dùng được một lần.\nNếu bạn không yêu cầu, hãy bỏ qua email này.\n\n' + org,
        name: APP.NAME
      });
    } catch (e) {
      withLock_(function () {
        var row = findBy_('AUTH_OTP', 'otp_id', toSend.otpId);
        if (row) { row.used = true; updateRow_('AUTH_OTP', row); }
      });
      audit_(null, 'OTP_SEND_FAIL', 'AUTH', '', 'ERROR', requestId, String(e && e.message || e).substring(0, 120));
    }
  }
  return { message: GENERIC_OTP_MSG };
}

function authVerifyOtp_(payload, requestId) {
  var email = normEmail_(payload && payload.email);
  var otp = String(payload && payload.otp || '').replace(/\s/g, '');
  if (!validEmail_(email) || !/^\d{6}$/.test(otp)) throw AppError_(ERR.VALIDATION, 'Hãy nhập đúng email và mã gồm 6 chữ số.');
  var emailHash = hmac_('email:' + email);

  return withLock_(function () {
    var cands = rows_('AUTH_OTP').filter(function (o) { return o.email_hash === emailHash && !o.used; });
    var rec = cands.length ? cands[cands.length - 1] : null;
    if (!rec || minutesSince_(rec.expires_at) > 0) {
      audit_(null, 'LOGIN', 'AUTH', '', 'DENIED', requestId, 'Không có mã hợp lệ');
      throw AppError_(ERR.AUTH, GENERIC_VERIFY_FAIL);
    }
    if (hmac_('otp:' + rec.otp_id + ':' + otp) !== rec.otp_hash) {
      rec.attempts = (rec.attempts || 0) + 1;
      if (rec.attempts >= APP.OTP_MAX_ATTEMPTS) rec.used = true;
      updateRow_('AUTH_OTP', rec);
      audit_(null, 'LOGIN', 'AUTH', '', 'DENIED', requestId, 'Sai mã lần ' + rec.attempts);
      if (rec.used) throw AppError_(ERR.AUTH, 'Bạn đã nhập sai quá ' + APP.OTP_MAX_ATTEMPTS + ' lần. Hãy bấm "Gửi lại mã" để nhận mã mới.');
      throw AppError_(ERR.AUTH, GENERIC_VERIFY_FAIL);
    }
    rec.used = true;
    updateRow_('AUTH_OTP', rec);

    var user = findBy_('USERS', 'email', email);
    if (!user || user.status !== 'active') throw AppError_(ERR.AUTH, GENERIC_VERIFY_FAIL);

    var token = randomHex_(64);
    var created = now_();
    insertRow_('SESSIONS', {
      session_id: newId_('SES'), token_hash: hmac_('session:' + token), user_id: user.user_id,
      created_at: created, expires_at: addMinutes_(created, APP.SESSION_TTL_HOURS * 60),
      last_seen_at: created, revoked: false, revoked_reason: ''
    });
    user.last_login_at = created;
    updateRow_('USERS', user);
    audit_({ user: user }, 'LOGIN', 'AUTH', user.user_id, 'OK', requestId, '');
    return { token: token, expiresInMin: APP.SESSION_TTL_HOURS * 60 };
  });
}

/**
 * Xác minh phiên ở mỗi lần gọi. Trả về ngữ cảnh người dùng (ctx) gồm quyền theo đơn vị.
 * Không tin bất kỳ email/role/unit_id nào do trình duyệt gửi.
 */
function authenticate_(token) {
  if (!token || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
    throw AppError_(ERR.AUTH, 'Bạn chưa đăng nhập hoặc phiên đã hết hạn. Vui lòng đăng nhập lại.');
  }
  var hash = hmac_('session:' + token);
  var sess = findBy_('SESSIONS', 'token_hash', hash);
  if (!sess || sess.revoked) throw AppError_(ERR.AUTH, 'Phiên đăng nhập không còn hiệu lực. Vui lòng đăng nhập lại.');
  if (minutesSince_(sess.expires_at) > 0 || minutesSince_(sess.last_seen_at) > APP.SESSION_IDLE_MIN) {
    throw AppError_(ERR.AUTH, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  }
  var user = findBy_('USERS', 'user_id', sess.user_id);
  if (!user || user.status !== 'active') {
    throw AppError_(ERR.AUTH, 'Tài khoản đã bị khóa hoặc thu hồi quyền. Liên hệ quản trị nếu cần hỗ trợ.');
  }
  // Cập nhật thời điểm hoạt động tối đa 1 lần / 5 phút (một ô, không cần khóa).
  if (minutesSince_(sess.last_seen_at) > 5) {
    try {
      var t = table_('SESSIONS');
      sheet_('SESSIONS').getRange(sess._row, t.index.last_seen_at + 1).setValue("'" + now_());
      sess.last_seen_at = now_();
    } catch (e) { /* không chặn thao tác nếu ghi thất bại */ }
  }
  var ctx = buildContext_(user);
  ctx.sessionId = sess.session_id;
  return ctx;
}

function authLogout_(ctx, p, requestId) {
  return withLock_(function () {
    var s = findBy_('SESSIONS', 'session_id', ctx.sessionId);
    if (s && !s.revoked) { s.revoked = true; s.revoked_reason = 'Đăng xuất'; updateRow_('SESSIONS', s); }
    audit_(ctx, 'LOGOUT', 'AUTH', ctx.user.user_id, 'OK', requestId, '');
    return { message: 'Đã đăng xuất.' };
  });
}

/** Thu hồi mọi phiên của người dùng (gọi khi đang giữ khóa). */
function revokeUserSessions_(userId, reason) {
  var list = rows_('SESSIONS').filter(function (s) { return s.user_id === userId && !s.revoked; });
  list.forEach(function (s) { s.revoked = true; s.revoked_reason = reason; });
  updateRows_('SESSIONS', list);
  return list.length;
}

/** Dọn dẹp OTP và phiên cũ — gọi từ tác vụ hằng ngày. */
function cleanupAuth_() {
  return withLock_(function () {
    var removed = 0;
    ['AUTH_OTP', 'SESSIONS'].forEach(function (name) {
      var t = table_(name);
      var keep = t.rows.filter(function (r) {
        var ref = name === 'AUTH_OTP' ? r.created_at : r.expires_at;
        return minutesSince_(ref) < 3 * 24 * 60; // giữ 3 ngày
      });
      removed += t.rows.length - keep.length;
      if (keep.length === t.rows.length) return;
      var sh = sheet_(name);
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, t.headers.length).clearContent();
      if (keep.length) sh.getRange(2, 1, keep.length, t.headers.length).setValues(keep.map(function (o) { return objToLine_(t, o); }));
      invalidate_(name);
    });
    return removed;
  });
}
