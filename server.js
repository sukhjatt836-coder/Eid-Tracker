// EID Tracker - Razorpay Backend (webhook-verified)
//
// This backend does NOT trust the browser to say "payment succeeded."
// It only marks an order as paid when Razorpay itself sends a signed
// webhook confirming the payment was captured. That webhook signature
// is checked with RAZORPAY_WEBHOOK_SECRET below.

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const app = express();
app.use(cors());

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

if (!KEY_ID || !KEY_SECRET) {
  console.error("Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET");
  process.exit(1);
}

const razorpay = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });

const orders = new Map();

app.post("/api/create-order", express.json(), async (req, res) => {
  try {
    const { amount, receipt } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: receipt || "receipt_" + Date.now(),
    });

    orders.set(order.id, { paid: false, payment_id: null, receipt: order.receipt });

    res.json({
      ok: true,
      key_id: KEY_ID,
      amount: order.amount,
      currency: order.currency,
      order_id: order.id,
    });
  } catch (err) {
    console.error("create-order error:", err);
    res.status(500).json({ ok: false, error: "Failed to create order" });
  }
});

app.post(
  "/api/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    if (!WEBHOOK_SECRET) {
      console.error("RAZORPAY_WEBHOOK_SECRET not set - rejecting webhook");
      return res.status(500).send("Webhook secret not configured");
    }

    const signature = req.headers["x-razorpay-signature"];
    const expected = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(req.body)
      .digest("hex");

    if (signature !== expected) {
      console.warn("Webhook signature mismatch - ignoring");
      return res.status(400).send("Invalid signature");
    }

    let payload;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.status(400).send("Bad payload");
    }

    const event = payload.event;
    if (event === "payment.captured" || event === "order.paid") {
      const paymentEntity = payload.payload?.payment?.entity;
      const orderId = paymentEntity?.order_id;
      const paymentId = paymentEntity?.id;
      if (orderId) {
        const existing = orders.get(orderId) || {};
        orders.set(orderId, { ...existing, paid: true, payment_id: paymentId });
        console.log(`Order ${orderId} confirmed paid via webhook (payment ${paymentId})`);
      }
    }

    res.status(200).send("ok");
  }
);

app.get("/api/order-status", express.json(), (req, res) => {
  const orderId = req.query.order_id;
  if (!orderId) return res.status(400).json({ paid: false, error: "Missing order_id" });

  const order = orders.get(orderId);
  if (!order) return res.json({ paid: false });

  res.json({
    paid: !!order.paid,
    details: { payment_id: order.payment_id },
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
