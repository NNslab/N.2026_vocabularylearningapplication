import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import nodemailer from 'nodemailer';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route for sending quiz results via Gmail
  app.post('/api/send-report', async (req, res) => {
    const { results, durationSeconds, dateStr } = req.body;
    
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;

    const correctCount = results.filter((r: any) => r.correct).length;
    
    const htmlContent = `
      <h2>晴晴的測驗成果</h2>
      <p><b>日期：</b>${dateStr}</p>
      <p><b>作答時間：</b>${durationSeconds} 秒</p>
      <p><b>得分：</b>${correctCount} / ${results.length}</p>
      <table border="1" style="border-collapse: collapse; width: 100%;">
        <thead>
          <tr style="background: #fdf2f8;">
            <th style="padding: 8px;">單字</th>
            <th style="padding: 8px;">晴晴的答案</th>
            <th style="padding: 8px;">是否正確</th>
          </tr>
        </thead>
        <tbody>
          ${results.map((r: any) => `
            <tr>
              <td style="padding: 8px;">${r.word}</td>
              <td style="padding: 8px;">${r.answer}</td>
              <td style="padding: 8px; color: ${r.correct ? 'green' : 'red'};">${r.correct ? '✅ 正確' : '❌ 錯誤'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Check if configuration is missing, empty, or still using placeholder values
    const isPlaceholder = (val?: string) => {
      if (!val) return true;
      const lower = val.toLowerCase().trim();
      return lower === '' || lower.includes('your-email') || lower.includes('your-app-specific');
    };

    if (isPlaceholder(user) || isPlaceholder(pass)) {
      console.log('=== [SIMULATED EMAIL TO DEVELOPER: b12203064@gmail.com] ===');
      console.log('Subject: 晴晴的測驗成果 -', dateStr);
      console.log('HTML CONTENT:');
      console.log(htmlContent);
      console.log('===========================================================');
      return res.json({ success: true, simulated: true, recipient: 'b12203064@gmail.com' });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass }
    });

    try {
      await transporter.sendMail({
        from: `"晴晴背單字" <${user}>`,
        to: 'b12203064@gmail.com', // Developer email
        subject: `晴晴的測驗成果 - ${dateStr}`,
        html: htmlContent
      });
      console.log('Real email sent successfully!');
      res.json({ success: true, simulated: false });
    } catch (error: any) {
      console.error('Error sending real email:', error);
      
      let friendlyError = '發送真實郵件失敗。';
      let hint = '';

      if (error?.message?.includes('535') || error?.code === 'EAUTH') {
        friendlyError = 'Gmail 登入失敗 (Invalid Login)。';
        hint = '這表示您的 Google 帳號或「應用程式密碼」不正確。請前往 Google 帳號設定，確認已啟用「兩步驟驗證」，並生成一組 16 位字元的「應用程式密碼 (App Password)」填入您的環境變數中的 GMAIL_APP_PASSWORD。不要填寫您的一般 Google 登入密碼！';
      } else {
        friendlyError = error?.message || '未知錯誤導致郵件發送失敗';
      }

      res.status(500).json({ 
        success: false, 
        error: friendlyError,
        hint: hint,
        code: error?.code || 'UNKNOWN'
      });
    }
  });

  // Older simulation route (can be removed or kept)
  app.post('/api/notify-learning-complete', (req, res) => {
    const { userEmail, stats } = req.body;
    
    // Simulate sending an email to the developer
    console.log('--- EMAIL NOTIFICATION SIMULATION ---');
    console.log('To: developer (B12203064@gmail.com)');
    console.log('Subject: Qing Qing Learning Progress Update');
    console.log(`User ${userEmail} completed a learning session!`);
    console.log('Stats:', stats);
    console.log('--- END OF SIMULATION ---');

    res.json({ success: true, message: 'Notification sent to developer' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Error starting server:', err);
});
