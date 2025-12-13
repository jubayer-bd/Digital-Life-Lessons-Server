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
    auth_email = req.decoded_email;
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
    await client.connect();
    console.log("✅ MongoDB Connected Successfully");

    // Collections
    const db = client.db("digital-life-lessons");
    const userCollection = db.collection("users");
    const lessonsCollection = db.collection("lessons");
    const paymentCollection = db.collection("payments");
    const commentsCollection = db.collection("comments");
    const savedLessons = db.collection("savedLessons");
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

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(user);
    });

    // Check Role
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      res.send({ role: user?.role || "user" });
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
        const id = req.params.id;
        const { role } = req.body;
        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: role } }
        );
        res.send(result);
      }
    );

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
        const email = auth_email;

        const lessons = await lessonsCollection
          .find({ authorEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(lessons);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch my lessons" });
      }
    });


    // Ping check
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Admin Ping Successful");
  } finally {
    // Keeps connection open
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("🚀 Digital Life Lessons Server is Running!");
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
