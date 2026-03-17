const nodemailer = require('nodemailer');
const { generateReciboPDF } = require('./pdf');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendPasswordResetEmail(toEmail, token, req) {
  const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
  const resetLink = `${baseUrl}/?reset_token=${token}`;

  await transporter.sendMail({
    from: `"Control de Agua" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Recuperación de Contraseña - Control de Agua',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#0ea5e9;margin-bottom:20px;">Recuperación de Contraseña</h2>
        <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
        <p>Haz clic en el botón para continuar:</p>
        <div style="text-align:center;margin:30px 0;">
          <a href="${resetLink}"
             style="background:#0ea5e9;color:white;padding:14px 28px;
                    text-decoration:none;border-radius:8px;font-size:16px;
                    display:inline-block;">
            Restablecer Contraseña
          </a>
        </div>
        <p style="color:#64748b;font-size:13px;">
          Este enlace expira en <strong>1 hora</strong>. Si no solicitaste el cambio, ignora este mensaje.
        </p>
        <p style="color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:10px;margin-top:20px;">
          Si el botón no funciona, copia y pega: ${resetLink}
        </p>
      </div>
    `
  });
}

async function sendReciboEmail(toEmail, registro, empresaNombre) {
  const fecha = new Date(registro.fecha).toLocaleDateString('es-GT');
  const total = (registro.monto_calculado || 0).toFixed(2);

  const pdfBuffer = await generateReciboPDF(registro, empresaNombre);

  const attachments = [
    {
      filename: `Recibo_${(registro.cliente_nombre || 'cliente').replace(/\s/g, '_')}_${Date.now()}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf'
    }
  ];

  // Attach meter photo if present
  if (registro.foto) {
    const match = registro.foto.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const [, mimeType, base64Data] = match;
      const ext = mimeType.split('/')[1] || 'jpg';
      attachments.push({
        filename: `Foto_Medidor_${(registro.cliente_nombre || 'medidor').replace(/\s/g, '_')}.${ext}`,
        content: Buffer.from(base64Data, 'base64'),
        contentType: mimeType
      });
    }
  }

  await transporter.sendMail({
    from: `"Control de Agua" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: `Recibo de Agua - ${registro.cliente_nombre} - ${fecha}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#0ea5e9;">Recibo de Consumo de Agua</h2>
        <p>Estimado(a) <strong>${registro.cliente_nombre}</strong>,</p>
        <p>Adjunto encontrará su recibo de consumo de agua correspondiente a <strong>${fecha}</strong>.</p>
        <div style="background:#f8fafc;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #e2e8f0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:8px;color:#64748b;">Lectura Anterior:</td>
              <td style="padding:8px;font-weight:bold;">${parseFloat(registro.lectura_anterior || 0).toFixed(2)} m³</td>
            </tr>
            <tr style="background:#fff;">
              <td style="padding:8px;color:#64748b;">Lectura Actual:</td>
              <td style="padding:8px;font-weight:bold;">${parseFloat(registro.lectura_actual || 0).toFixed(2)} m³</td>
            </tr>
            <tr>
              <td style="padding:8px;color:#64748b;">Consumo:</td>
              <td style="padding:8px;font-weight:bold;">${parseFloat(registro.consumo || 0).toFixed(2)} m³</td>
            </tr>
            <tr style="background:#dcfce7;">
              <td style="padding:8px;font-weight:bold;color:#166534;">Total a Pagar:</td>
              <td style="padding:8px;font-weight:bold;color:#166534;font-size:18px;">Q${total}</td>
            </tr>
          </table>
        </div>
        <p>Por favor realice su pago a la brevedad posible.</p>
        <p style="color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:10px;">
          Correo enviado automáticamente por el sistema de Control de Agua.
        </p>
      </div>
    `,
    attachments
  });
}

module.exports = { sendPasswordResetEmail, sendReciboEmail };
