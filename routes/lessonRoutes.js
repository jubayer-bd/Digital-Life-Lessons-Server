const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");

module.exports = (col, fbAdmin) => {
  const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) return res.status(401).send({ message: "Unauthorized" });
    try {
      const decoded = await fbAdmin.auth().verifyIdToken(token.split(" ")[1]);
      req.decoded_email = decoded.email;
      next();
    } catch (e) {
      res.status(401).send({ message: "Invalid token" });
    }
  };

  // GET: Public Lessons (Fixed: added isDeleted filter)
  router.get("/lessons", async (req, res) => {
    const query = { visibility: "public", isDeleted: { $ne: true } };
    const result = await col.lessons
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    res.send(result);
  });

  // GET: Single Lesson
  router.get("/lessons/:id", async (req, res) => {
    try {
      const result = await col.lessons.findOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    } catch (e) {
      res.status(400).send({ message: "Invalid ID format" });
    }
  });

  // PATCH: Toggle Like
  router.patch("/lessons/:id/like", verifyFBToken, async (req, res) => {
    const id = req.params.id;
    const email = req.decoded_email;
    const lesson = await col.lessons.findOne({ _id: new ObjectId(id) });
    const isLiked = lesson?.likes?.includes(email);

    const update = isLiked
      ? { $pull: { likes: email }, $inc: { likesCount: -1 } }
      : { $push: { likes: email }, $inc: { likesCount: 1 } };

    await col.lessons.updateOne({ _id: new ObjectId(id) }, update);
    res.send({ success: true, isLiked: !isLiked });
  });

  // PATCH: Trash Lesson (Soft Delete)
  router.patch("/lessons/:id/trash", verifyFBToken, async (req, res) => {
    const lesson = await col.lessons.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (lesson.authorEmail !== req.decoded_email)
      return res.status(403).send({ message: "Forbidden" });

    // BUG FIX: Added deletedAt for potential data recovery tasks
    const result = await col.lessons.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { isDeleted: true, deletedAt: new Date() } }
    );
    res.send({ success: true });
  });

  // POST: Report Lesson
  router.post("/lessons/:id/report", verifyFBToken, async (req, res) => {
    const { reason } = req.body;
    const report = {
      lessonId: req.params.id,
      reason,
      userEmail: req.decoded_email,
      createdAt: new Date(),
    };
    await col.reports.insertOne(report);
    await col.lessons.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $inc: { reportCount: 1 } }
    );
    res.send({ success: true });
  });

  // --- COMMENTS SUB-API ---
  router.get("/lessons/:id/comments", async (req, res) => {
    const result = await col.comments
      .find({ lessonId: req.params.id })
      .sort({ createdAt: -1 })
      .toArray();
    res.send(result);
  });

  return router;
};
