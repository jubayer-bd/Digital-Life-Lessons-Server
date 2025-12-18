const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");

module.exports = (col, fbAdmin) => {
  // Shared Middleware
  const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) return res.status(401).send({ message: "No token provided" });
    try {
      const idToken = token.split(" ")[1];
      const decoded = await fbAdmin.auth().verifyIdToken(idToken);
      req.decoded_email = decoded.email;
      next();
    } catch (e) {
      res.status(401).send({ message: "Invalid token" });
    }
  };

  // POST: Create/Update User
  router.post("/users", async (req, res) => {
    const user = req.body;
    const userExist = await col.users.findOne({ email: user.email });
    if (userExist)
      return res.send({ message: "User exists", insertedId: null });

    const newUser = {
      ...user,
      role: "user",
      isPremium: false,
      createdAt: new Date(),
    };
    const result = await col.users.insertOne(newUser);
    res.send(result);
  });

  // GET: Profile Stats
  router.get("/users/profile-stats", verifyFBToken, async (req, res) => {
    const email = req.decoded_email;
    const created = await col.lessons.countDocuments({ authorEmail: email });
    const saved = await col.lessons.countDocuments({ favorites: email });
    res.send({ created, saved });
  });

  // GET: User Role
  router.get("/users/:email/role", async (req, res) => {
    const user = await col.users.findOne({ email: req.params.email });
    res.send({ role: user?.role || null });
  });

  // GET: Specific User Profile
  router.get("/users/:email", verifyFBToken, async (req, res) => {
    const user = await col.users.findOne(
      { email: req.params.email },
      { projection: { transactionId: 0 } } // BUG FIX: Security - hidden sensitive field
    );
    if (!user) return res.status(404).send({ message: "Not found" });
    res.send(user);
  });

  // PATCH: Update Profile
  router.patch("/users/profile", verifyFBToken, async (req, res) => {
    const { name, photo } = req.body;
    // BUG FIX: Added proper $set and handled upsert logic correctly
    await col.users.updateOne(
      { email: req.decoded_email },
      { $set: { name, photo, updatedAt: new Date() } },
      { upsert: true }
    );
    res.send({ success: true });
  });

  return router;
};
