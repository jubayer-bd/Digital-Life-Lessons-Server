const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;
const crypto = require("crypto");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");

// --- 1. CONFIGURATION ---
// Ideally, use an environment variable for the service account path or parse a JSON string
var serviceAccount = require("./firebaseAdmin.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// --- 2. MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// Helper: Verify Firebase Token
const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized access: No token" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    // auth_email = req.decoded_email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized: Invalid token" });
  }
};

// --- 3. DATABASE CONNECTION ---
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@jubayer.zuekl8x.mongodb.net/?appName=Jubayer`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    console.log("✅ MongoDB Connected Successfully");

    // Collections
    const db = client.db("digital-life-lessons");
    const userCollection = db.collection("users");
    const lessonsCollection = db.collection("lessons");
    const paymentCollection = db.collection("payments");
    const commentsCollection = db.collection("comments");
    const savedLessons = db.collection("savedLessons");
    const reportsCollection = db.collection("report");
    // Middleware: Verify Admin
    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.decoded_email;
        const user = await userCollection.findOne({ email });
        if (!user || user.role !== "admin") {
          return res.status(403).send({ message: "Forbidden: Not an admin" });
        }
        next();
      } catch (error) {
        return res.status(500).send({ message: "Server error checking admin" });
      }
    };

    // ==========================================
    // USER API
    // ==========================================

    // Create or Update User
    app.post("/users", async (req, res) => {
      const user = req.body;
      const email = user.email;

      const userExist = await userCollection.findOne({ email });
      if (userExist) {
        return res.send({ message: "User already exists", insertedId: null });
      }

      const newUser = {
        ...user,
        role: "user",
        isPremium: false,
        createdAt: new Date(),
      };

      const result = await userCollection.insertOne(newUser);
      res.send(result);
    });

    // user profile
    app.get("/users/profile-stats", verifyFBToken, async (req, res) => {
      const email = req.decoded_email;

      const created = await lessonsCollection.countDocuments({
        authorEmail: email,
      });

      const saved = await lessonsCollection.countDocuments({
        favorites: email,
      });

      res.send({ created, saved });
    });

    // Check Role
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ role: null });
      }

      res.send({ role: user.role });
    });

    // app.get("/users/:email", async (req, res) => {
    //   const email = req.params.email;
    //   const user = await userCollection.findOne({ email });
    //   if (!user) return res.status(404).json({ message: "User not found" });
    //   res.json(user);
    // });
    app.get("/users/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;

      // const requester = await userCollection.findOne({
      //   email: req.decoded_email,
      // });

      // if (email !== req.decoded_email && requester?.role !== "admin") {
      //   return res.status(403).send({ message: "Forbidden" });
      // }
      if (!email) {
        return res.status(404).send({ message: "email required" });
      }

      const user = await userCollection.findOne(
        { email },
        { projection: { transactionId: 0 } }
      );

      if (!user) return res.status(404).send({ message: "User not found" });

      res.send(user);
    });

    // GET: Get all lessons created by a specific user (via email)
    app.get("/users/:email/lessons", async (req, res) => {
      try {
        const email = req.params.email;
        const query = { authorEmail: email };

        // Sort by newest first
        const result = await lessonsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching user lessons:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // Check Premium Status
    app.get("/users/:email/isPremium", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      res.send({ isPremium: user?.isPremium === true });
    });

    // Admin: Manage Users
    app.get("/users", verifyFBToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          const { role } = req.body;

          if (!["admin", "user"].includes(role)) {
            return res.status(400).send({ message: "Invalid role" });
          }

          const result = await userCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role } }
          );

          res.send(result);
        } catch (error) {
          res.status(500).send({ message: "Failed to update role" });
        }
      }
    );
    app.delete("/users/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;

        const result = await userCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to delete user" });
      }
    });

    // admin
    app.get("/admin/stats", verifyFBToken, verifyAdmin, async (req, res) => {
      const totalUsers = await userCollection.countDocuments();
      const totalPublicLessons = await lessonsCollection.countDocuments({
        visibility: "public",
      });
      const reportedLessons = await lessonsCollection.countDocuments({
        isReported: true,
      });

      const today = new Date().toISOString().slice(0, 10);

      const todayLessons = await lessonsCollection.countDocuments({
        createdAt: { $gte: today },
      });

      const topContributors = await lessonsCollection
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

      res.send({
        totalUsers,
        totalPublicLessons,
        reportedLessons,
        todayLessons,
        topContributors,
        lessonGrowth: [], // optional (daily aggregation)
        userGrowth: [],
      });
    });

    // ==========================================
    // LESSONS API
    // ==========================================

    // Get All Public Lessons
    app.get("/lessons", async (req, res) => {
      try {
        const query = { visibility: "public" };
        const lessons = await lessonsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.send(lessons);
      } catch (err) {
        res.status(500).send({ message: "Error fetching lessons" });
      }
    });

    // Get Single Lesson

    // Create Lesson
    app.post("/lessons", verifyFBToken, async (req, res) => {
      const lesson = req.body;

      // Initialize counters and arrays
      lesson.likes = [];
      lesson.favorites = [];
      lesson.likesCount = 0;
      lesson.favoritesCount = 0;
      lesson.authorEmail = req.decoded_email;
      lesson.createdAt = new Date(); // Important: Store as Date object for sorting/analytics

      const result = await lessonsCollection.insertOne(lesson);
      res.send(result);
    });

    // Get User's Created Lessons
    app.get("/lessons/my-lessons", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;

        const lessons = await lessonsCollection
          .find({ authorEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(lessons);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch my lessons" });
      }
    });

    // Get User's Saved (Favorited) Lessons

    app.get("/lessons/saved", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;

        const { category, tone } = req.query;

        // Base query: only lessons saved by user
        const query = {
          favorites: email,
        };

        // Optional filters (only applied if present)
        if (category) {
          query.category = category;
        }

        if (tone) {
          query.emotionalTone = tone;
        }

        const result = await lessonsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });
    // GET /lessons/related
    // Query Params: ?category=...&tone=...&id=...
    app.get("/lessons/related", verifyFBToken, async (req, res) => {
      try {
        const { category, tone, id } = req.query;
        const query = {
          _id: { $ne: new ObjectId(id) },
          $or: [{ category: category }, { emotionalTone: tone }],
        };

        // Fetch 6 random matches (or sort by date)
        const related = await lessonsCollection.find(query).limit(6).toArray();

        res.send(related);
      } catch (error) {
        console.error("Error fetching related lessons:", error);
        res.status(500).send({ message: "Failed to fetch related lessons" });
      }
    });
    // recent lessons
    app.get("/lessons/recent", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;

        const lessons = await lessonsCollection
          .find({ authorEmail: email })
          .sort({ createdAt: -1 })
          .limit(3)
          .toArray();

        res.send(lessons);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch recent lessons" });
      }
    });

    // Lesson Analytics (Daily creation count)
    app.get("/lessons/analytics", verifyFBToken, async (req, res) => {
      const email = req.decoded_email; // Corrected from req.user

      const pipeline = [
        { $match: { authorEmail: email } },
        {
          $group: {
            _id: { $dayOfWeek: "$createdAt" }, // Returns 1 (Sun) to 7 (Sat)
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ];

      const result = await lessonsCollection.aggregate(pipeline).toArray();

      const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const counts = Array(7).fill(0);

      result.forEach((d) => {
        // Mongo dayOfWeek is 1-based (1=Sun), Array is 0-based
        if (d._id) counts[d._id - 1] = d.count;
      });

      res.send({ labels, counts });
    });

    app.get("/lessons/admin", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        // Fetch all lessons and populate user details
        const lessons = await lessonsCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.send(lessons);
      } catch (error) {
        res.status(500).send({ message: "Error fetching lessons" });
      }
    });

    // 2. DELETE LESSON (ADMIN)
    // Route: DELETE /lessons/:id
    app.delete(
      "/lessons/:id/admin",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        try {
          const lesson = await lessonsCollection.findOne({
            _id: new ObjectId(id),
          });
          if (!lesson) {
            return res.status(404).send({ message: "lesson is not found" });
          }
          // Optional: Decrement user's lesson count if you are tracking it in User model
          const result = await lessonsCollection.deleteOne({
            _id: new ObjectId(id),
          });
          res.send(result);
        } catch (error) {
          res.status(500).send({ message: "Error deleting lesson" });
        }
      }
    );

    app.patch(
      "/lessons/:id/featured",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          const { featured } = req.body;

          // Validate featured value
          if (typeof featured !== "boolean") {
            return res.status(400).send({
              message: "Featured must be true or false",
            });
          }

          const lesson = await lessonsCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!lesson) {
            return res.status(404).send({
              message: "Lesson not found",
            });
          }

          const result = await lessonsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                featured,
                updatedAt: new Date(),
              },
            }
          );

          res.send({
            success: true,
            featured,
            modifiedCount: result.modifiedCount,
          });
        } catch (error) {
          res.status(500).send({
            message: "Failed to update featured lesson",
            error: error.message,
          });
        }
      }
    );

    // 4. MARK AS REVIEWED
    app.patch(
      "/lessons/:id/reviewed",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          const { isReviewed } = req.body;

          if (typeof isReviewed !== "boolean") {
            return res.status(400).send({
              message: "isReviewed must be boolean",
            });
          }

          const lesson = await lessonsCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!lesson) {
            return res.status(404).send({ message: "Lesson not found" });
          }

          const result = await lessonsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                isReviewed,
                updatedAt: new Date(),
              },
            }
          );

          res.send({
            success: true,
            isReviewed,
            modifiedCount: result.modifiedCount,
          });
        } catch (error) {
          res.status(500).send({ message: "Error marking as reviewed" });
        }
      }
    );
    //
    app.get("/top-contributors", async (req, res) => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const result = await lessonsCollection
        .aggregate([
          {
            $match: {
              visibility: "public",
              createdAt: { $gte: sevenDaysAgo },
            },
          },
          {
            $group: {
              _id: "$authorEmail",
              authorName: { $first: "$authorName" },
              authorImage: { $first: "$authorImage" },
              totalLessons: { $sum: 1 },
            },
          },
          {
            $sort: { totalLessons: -1 },
          },
          {
            $limit: 4,
          },
          {
            $project: {
              _id: 0,
              email: "$_id",
              name: "$authorName",
              photo: "$authorImage",
              totalLessons: 1,
            },
          },
        ])
        .toArray();

      res.send(result);
    });
    app.get("/most-saved-lessons", async (req, res) => {
      const result = await lessonsCollection
        .find({ visibility: "public" })
        .sort({ favoritesCount: -1 })
        .limit(6)
        .project({
          title: 1,
          description: 1,
          authorName: 1,
          favoritesCount: 1,
          image: 1,
          category: 1,
        })
        .toArray();

      res.send(result);
    });

    app.get(
      "/admin/reported-lessons",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const lessons = await lessonsCollection
          .find({ reportCount: { $gt: 0 } })
          .project({ title: 1, reportCount: 1 })
          .toArray();

        res.send(lessons);
      }
    );
    app.get(
      "/lessons/:id/reports",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const reports = await reportsCollection
          .find({ lessonId: req.params.id })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(reports);
      }
    );
    app.post("/lessons/:id/report", verifyFBToken, async (req, res) => {
      const { reason } = req.body;
      const email = req.decoded_email;

      const user = await userCollection.findOne({ email });

      const report = {
        lessonId: req.params.id,
        reason,
        userId: user?._id,
        userName: user?.displayName || "Anonymous",
        userEmail: email,
        createdAt: new Date(),
      };

      await reportsCollection.insertOne(report);

      await lessonsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $inc: { reportCount: 1 } }
      );

      res.send({ success: true });
    });
    app.patch(
      "/admin/lessons/:id/ignore-reports",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const lessonId = req.params.id;

        await reportsCollection.deleteMany({ lessonId });

        await lessonsCollection.updateOne(
          { _id: new ObjectId(lessonId) },
          { $set: { reportCount: 0 } }
        );

        res.send({ success: true });
      }
    );
    app.get("/admin/profile", verifyFBToken, verifyAdmin, async (req, res) => {
      const email = req.decoded_email;

      const admin = await userCollection.findOne(
        { email },
        {
          projection: {
            displayName: 1,
            email: 1,
            photoURL: 1,
            role: 1,
            stats: 1, // optional activity stats
          },
        }
      );

      res.send(admin);
    });
    app.patch(
      "/admin/profile",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.decoded_email;
        const { displayName, photoURL } = req.body;

        await userCollection.updateOne(
          { email },
          {
            $set: {
              displayName,
              photoURL,
              updatedAt: new Date(),
            },
          }
        );

        res.send({ success: true });
      }
    );

    app.delete(
      "/admin/lessons/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const lessonId = req.params.id;

        await lessonsCollection.deleteOne({ _id: new ObjectId(lessonId) });
        await reportsCollection.deleteMany({ lessonId });

        res.send({ success: true });
      }
    );

    // profile
    app.get("/lessons/user/:email", async (req, res) => {
      const email = req.params.email;

      const lessons = await lessonsCollection
        .find({
          authorEmail: email,
          visibility: "public",
        })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(lessons);
    });
    app.patch("/users/profile", verifyFBToken, async (req, res) => {
      const email = req.decoded_email;
      const { name, photo } = req.body;

      await userCollection.updateOne(
        { email },
        { $set: { name, photo } },
        { upsert: true }
      );

      res.send({ success: true });
    });
    app.get("/lessons/featured", async (req, res) => {
      try {
        const { limit = 6 } = req.query;

        const featuredLessons = await lessonsCollection
          .find({ featured: true, visibility: "public" })
          .sort({ updatedAt: -1 }) // latest featured first
          .limit(Number(limit))
          .toArray();

        res.send({
          success: true,
          count: featuredLessons.length,
          lessons: featuredLessons,
        });
      } catch (error) {
        res.status(500).send({
          message: "Failed to fetch featured lessons",
          error: error.message,
        });
      }
    });

    app.get("/lessons/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await lessonsCollection.findOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (e) {
        res.status(404).send({ message: "Lesson not found" });
      }
    });

    // Soft delete endpoint (Move to Trash)
    app.patch("/lessons/:id/trash", verifyFBToken, async (req, res) => {
      const { id } = req.params;
      const email = req.decoded_email;

      try {
        const lesson = await lessonsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!lesson) {
          return res.status(404).send({ message: "Lesson not found" });
        }

        // Only the author can trash their lesson
        if (lesson.authorEmail !== email) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        // Perform the soft delete (update isDeleted flag)
        const result = await lessonsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              isDeleted: true,
              deletedAt: new Date(),
            },
          }
        );

        res.send({
          success: true,
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Error moving to trash:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });
    app.patch("/lessons/:id", verifyFBToken, async (req, res) => {
      const { id } = req.params;
      const email = req.decoded_email;

      const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) });

      if (!lesson) {
        return res.status(404).send({ message: "Lesson not found" });
      }

      // Only author can edit
      if (lesson.authorEmail !== email) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      const {
        title,
        description,
        category,
        emotionalTone,
        image,
        visibility,
        accessLevel,
      } = req.body;

      const updateDoc = {
        $set: {
          title,
          description,
          category,
          emotionalTone,
          image,
          visibility,
          accessLevel,
          updatedAt: new Date(),
        },
      };

      const result = await lessonsCollection.updateOne(
        { _id: new ObjectId(id) },
        updateDoc
      );

      res.send({
        success: true,
        modifiedCount: result.modifiedCount,
      });
    });

    // Like Functionality
    app.patch("/lessons/:id/like", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const email = req.decoded_email;

      const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) });
      const isLiked = lesson?.likes?.includes(email);

      let updateDoc;
      if (isLiked) {
        updateDoc = { $pull: { likes: email }, $inc: { likesCount: -1 } };
      } else {
        updateDoc = { $push: { likes: email }, $inc: { likesCount: 1 } };
      }

      const result = await lessonsCollection.updateOne(
        { _id: new ObjectId(id) },
        updateDoc
      );
      res.send({ success: true, isLiked: !isLiked });
    });

    // Favorite Functionality
    app.patch("/lessons/:id/favorite", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const email = req.decoded_email;
        const queryId = new ObjectId(id);

        const lesson = await lessonsCollection.findOne({ _id: queryId });

        if (!lesson) {
          return res
            .status(404)
            .send({ success: false, message: "Lesson not found" });
        }

        const isFavorited = lesson?.favorites?.includes(email);
        let updateDoc;

        if (isFavorited) {
          // REMOVE FAVORITE
          updateDoc = {
            $pull: { favorites: email },
            $inc: { favoritesCount: lesson.favoritesCount > 0 ? -1 : 0 },
          };
          // Delete from the separate savedLessons collection
          await savedLessons.deleteOne({ lessonId: queryId, userEmail: email });
        } else {
          // ADD FAVORITE
          updateDoc = {
            $addToSet: { favorites: email },
            $inc: { favoritesCount: 1 },
          };
          // Upsert into savedLessons collection
          await savedLessons.updateOne(
            { lessonId: queryId, userEmail: email },
            {
              $set: {
                lessonId: queryId,
                userEmail: email,
                title: lesson.title,
                image: lesson.image,
              },
            },
            { upsert: true }
          );
        }

        await lessonsCollection.updateOne({ _id: queryId }, updateDoc);

        res.send({
          success: true,
          isFavorited: !isFavorited,
          message: isFavorited
            ? "Removed from favorites"
            : "Added to favorites",
        });
      } catch (error) {
        console.error("Favorite error:", error);
        res.status(500).send({ success: false, error: error.message });
      }
    });

    // ==========================================
    // COMMENTS
    // ==========================================
    app.get("/lessons/:id/comments", async (req, res) => {
      try {
        const lessonId = req.params.id;

        const comments = await commentsCollection
          .find({ lessonId })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(comments);
      } catch (error) {
        res.status(500).send({ message: "Failed to load comments" });
      }
    });

    app.post("/lessons/:id/comments", verifyFBToken, async (req, res) => {
      try {
        const { content } = req.body;
        const email = req.decoded_email;

        if (!content?.trim()) {
          return res.status(400).send({ message: "Comment is required" });
        }

        const user = await userCollection.findOne({ email });

        const newComment = {
          lessonId: req.params.id,
          userId: user?._id || null,
          userName: user?.displayName || "Anonymous",
          userImg: user?.photoURL || null,
          content,
          createdAt: new Date(),
        };

        const result = await commentsCollection.insertOne(newComment);

        // 🔥 IMPORTANT: return the full comment with _id
        res.send({
          _id: result.insertedId,
          ...newComment,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to post comment" });
      }
    });

    // ==========================================
    // PAYMENT (STRIPE)
    // ==========================================
    app.post("/payment-checkout-session", async (req, res) => {
      const { email } = req.body;
      const amount = 1500 * 100; // 1500 BDT in cents

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          customer_email: email,
          line_items: [
            {
              price_data: {
                currency: "bdt",
                unit_amount: amount,
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

    app.patch("/payment-success", async (req, res) => {
      const { session_id } = req.query;
      if (!session_id)
        return res.status(400).send({ message: "Session ID missing" });

      try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        if (session.payment_status === "paid") {
          const { userEmail, transactionType } = session.metadata;

          if (transactionType === "premium-upgrade") {
            await userCollection.updateOne(
              { email: userEmail },
              {
                $set: {
                  isPremium: true,
                  transactionId: session.payment_intent,
                },
              }
            );

            await paymentCollection.insertOne({
              email: userEmail,
              amount: session.amount_total / 100,
              transactionId: session.payment_intent,
              date: new Date(),
              type: "premium-upgrade",
            });
            return res.send({ success: true });
          }
        }
        res.send({ success: false });
      } catch (e) {
        res.status(500).send({ message: "Error processing payment" });
      }
    });

    // Ping check
    // await client.db("admin").command({ ping: 1 });
    console.log("✅ Admin Ping Successful");
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("🚀 Digital Life Lessons Server is Running!");
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
