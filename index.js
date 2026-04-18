const express = require("express");
const app = express();

app.use(express.json());

// 首页
app.get("/", (req, res) => {
  res.send("henxin-ai is running");
});

// LINE webhook
app.post("/webhook", (req, res) => {
  console.log("Webhook received:", req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
