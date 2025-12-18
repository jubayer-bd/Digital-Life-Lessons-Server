const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

module.exports = (col) => {
  router.post("/payment-checkout-session", async (req, res) => {
    const { email } = req.body;
    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        customer_email: email,
        line_items: [
          {
            price_data: {
              currency: "bdt",
              unit_amount: 150000, // 1500 BDT
              product_data: { name: "Premium Membership" },
            },
            quantity: 1,
          },
        ],
        metadata: { userEmail: email, transactionType: "premium-upgrade" },
        success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/premium`,
      });
      res.send({ url: session.url });
    } catch (e) {
      res.status(500).send({ error: e.message });
    }
  });

  router.patch("/payment-success", async (req, res) => {
    const { session_id } = req.query;
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (session.payment_status === "paid") {
        const { userEmail } = session.metadata;

        // Update User to Premium
        await col.users.updateOne(
          { email: userEmail },
          { $set: { isPremium: true, transactionId: session.payment_intent } }
        );

        // Record Payment
        await col.payments.insertOne({
          email: userEmail,
          amount: session.amount_total / 100,
          transactionId: session.payment_intent,
          date: new Date(),
        });
        res.send({ success: true });
      } else {
        res
          .status(400)
          .send({ success: false, message: "Payment not verified" });
      }
    } catch (e) {
      res.status(500).send({ message: "Processing Error" });
    }
  });

  return router;
};
