const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 3000;

// --- FIREBASE ADMIN SETUP ---
const serviceAccount = require("./firebaseAdmin.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- DATABASE CONNECTION ---
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
    // BUG FIX: Removed 'await client.connect()' for environments like Vercel
    // where persistent connections behave differently. Connection happens on demand.
    const db = client.db("digital-life-lessons");

    // Collections
    const collections = {
      users: db.collection("users"),
      lessons: db.collection("lessons"),
      payments: db.collection("payments"),
      comments: db.collection("comments"),
      savedLessons: db.collection("savedLessons"),
      reports: db.collection("report"),
    };

    console.log("✅ MongoDB Collections Initialized");

    // --- IMPORT ROUTERS ---
    // Pass 'admin' and 'collections' to the routers
    const userRoutes = require("./routes/userRoutes")(collections, admin);
    const lessonRoutes = require("./routes/lessonRoutes")(collections, admin);
    const adminRoutes = require("./routes/adminRoutes")(collections, admin);
    const paymentRoutes = require("./routes/paymentRoutes")(collections, admin);

    // --- MOUNT ROUTES (No URL changes) ---
    app.use("/", userRoutes);
    app.use("/", lessonRoutes);
    app.use("/", adminRoutes);
    app.use("/", paymentRoutes);

    app.get("/", (req, res) => {
      res.send("🚀 Digital Life Lessons Server is Running!");
    });
  } catch (error) {
    console.error("Database Connection Error:", error);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
