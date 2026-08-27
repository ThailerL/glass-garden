import express from 'express';
const app = express();
const port = process.env.PORT || 3000;
// Picked once at startup so every instance of this group serves a different number
const instanceId = Math.floor(Math.random() * 10000);

app.get('/', (req, res) => {
  res.send(`Hello World from instance ${instanceId}`);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});