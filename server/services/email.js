const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const FROM = process.env.SMTP_FROM || `"His Secret Vault" <${process.env.SMTP_USER}>`;

async function sendEmail(to, subject, html) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`[Email skipped - SMTP not configured] To: ${to} | Subject: ${subject}`);
    return false;
  }
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    return true;
  } catch (err) {
    console.error('Email send error:', err.message);
    return false;
  }
}

async function sendWelcome(to, firstName) {
  return sendEmail(to, 'Welcome to His Secret Vault!', `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1a365d">Welcome, ${firstName}!</h2>
      <p>Your account has been created successfully. You now have access to your dashboard where you can track your services and progress.</p>
      <a href="https://hissecretvault.net/dashboard" style="display:inline-block;background:#c9a227;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin:16px 0">Go to Dashboard</a>
      <p style="color:#666;font-size:14px">Questions? Reply to this email and we'll help you out.</p>
      <p>— The His Secret Vault Team</p>
    </div>
  `);
}

async function sendOrderConfirmation(to, firstName, serviceName, amount, orderId) {
  return sendEmail(to, `Order Confirmed — ${serviceName}`, `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1a365d">Order Confirmed!</h2>
      <p>Hi ${firstName}, your order has been received and we're getting started.</p>
      <div style="background:#f7fafc;border-left:4px solid #c9a227;padding:16px;margin:20px 0">
        <strong>Service:</strong> ${serviceName}<br>
        <strong>Amount:</strong> $${(amount / 100).toFixed(2)}<br>
        <strong>Order ID:</strong> #${orderId}
      </div>
      <p>Track your progress anytime in your dashboard:</p>
      <a href="https://hissecretvault.net/dashboard" style="display:inline-block;background:#c9a227;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin:16px 0">View Dashboard</a>
      <p>— The His Secret Vault Team</p>
    </div>
  `);
}

async function sendPasswordReset(to, firstName, resetUrl) {
  return sendEmail(to, 'Reset Your Password — His Secret Vault', `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1a365d">Reset Your Password</h2>
      <p>Hi ${firstName}, we received a request to reset your password.</p>
      <p>Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
      <a href="${resetUrl}" style="display:inline-block;background:#1a365d;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin:16px 0">Reset My Password</a>
      <p style="color:#666;font-size:13px">If you didn't request this, you can safely ignore this email. Your password won't change.</p>
      <p>— The His Secret Vault Team</p>
    </div>
  `);
}

module.exports = { sendEmail, sendWelcome, sendOrderConfirmation, sendPasswordReset };
