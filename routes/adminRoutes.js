const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");

module.exports = (col, fbAdmin) => {
  const verifyAdmin = async (req, res, next) => {
    const token = req.headers.authorization;
    try {
      const decoded = await fbAdmin.auth().verifyIdToken(token.split(" ")[1]);
      const user = await col.users.findOne({ email: decoded.email });
      if (user?.role !== "admin")
        return res.status(403).send({ message: "Admin Only" });
      req.decoded_email = decoded.email;
      next();
    } catch (e) {
      res.status(401).send({ message: "Unauthorized" });
    }
  };

  router.get("/admin/stats", verifyAdmin, async (req, res) => {
    const totalUsers = await col.users.countDocuments();
    const totalPublicLessons = await col.lessons.countDocuments({
      visibility: "public",
    });

    // BUG FIX: Corrected Date comparison logic for "Today"
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayLessons = await col.lessons.countDocuments({
      createdAt: { $gte: startOfToday },
    });

    const topContributors = await col.lessons
      .aggregate([
        {
          $group: {
            _id: "$authorEmail",
            lessonCount: { $sum: 1 },
            name: { $first: "$authorName" },
          },
        },
        { $sort: { lessonCount: -1 } },
        { $limit: 5 },
      ])
      .toArray();

    res.send({ totalUsers, totalPublicLessons, todayLessons, topContributors });
  });

  router.patch("/users/:id/role", verifyAdmin, async (req, res) => {
    const { role } = req.body;
    if (!["admin", "user"].includes(role))
      return res.status(400).send({ message: "Invalid role" });
    const result = await col.users.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { role } }
    );
    res.send(result);
  });

  return router;
};
