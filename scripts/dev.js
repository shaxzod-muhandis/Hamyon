// Lokal server (webhook uchun ngrok/cloudflared kerak bo'ladi).
require("./_env").loadEnv();
const app = require("../src/app");
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`http://localhost:${port}`));
