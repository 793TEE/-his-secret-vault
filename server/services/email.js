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

async function sendOrderProgress(to, firstName, serviceName, stepName, orderId, isComplete) {
  const subject = isComplete
    ? `Your ${serviceName} is Complete!`
    : `Update on Your ${serviceName} Order`;

  const headline = isComplete
    ? `Great news, ${firstName} — your order is complete!`
    : `Your order just moved forward, ${firstName}!`;

  const badge = isComplete
    ? `<div style="display:inline-block;background:#38a169;color:#fff;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:700;margin-bottom:16px">&#10003; Completed</div>`
    : `<div style="display:inline-block;background:#1a365d;color:#fff;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:700;margin-bottom:16px">&#9654; In Progress</div>`;

  return sendEmail(to, subject, `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#0f2744,#1a365d);padding:28px 32px;border-radius:10px 10px 0 0">
        <div style="color:#c9a227;font-weight:800;font-size:1rem;margin-bottom:6px">His Secret Vault</div>
        <h2 style="color:#fff;margin:0;font-size:1.4rem">${headline}</h2>
      </div>
      <div style="background:#fff;padding:28px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
        <p style="color:#4a5568;margin-bottom:20px">Here's the latest on your <strong>${serviceName}</strong> order:</p>
        <div style="background:#f7fafc;border-left:4px solid #c9a227;padding:16px 20px;border-radius:4px;margin-bottom:20px">
          <div style="font-size:13px;color:#718096;margin-bottom:4px">Current Step</div>
          ${badge}
          <div style="font-weight:700;font-size:1.05rem;color:#1a365d">${stepName}</div>
        </div>
        ${isComplete
          ? `<p style="color:#4a5568">Your order has been completed. All deliverables are ready for you in your dashboard.</p>`
          : `<p style="color:#4a5568">Our team is actively working on this step. We'll notify you again when it's complete.</p>`}
        <a href="https://hissecretvault.net/dashboard/orders" style="display:inline-block;background:#c9a227;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin:16px 0">Track Your Order</a>
        <p style="color:#a0aec0;font-size:13px;margin-top:16px">Order #${orderId} · Questions? Reply to this email.</p>
        <p style="color:#718096">— The His Secret Vault Team</p>
      </div>
    </div>
  `);
}

module.exports = { sendEmail, sendWelcome, sendOrderConfirmation, sendPasswordReset, sendOrderProgress };
