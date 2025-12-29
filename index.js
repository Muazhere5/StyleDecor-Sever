require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

/* ============================
   STRIPE
============================ */
let stripe = null;
if (process.env.STRIPE_SECRET) {
  stripe = require("stripe")(process.env.STRIPE_SECRET);
}

/* ============================
   FIREBASE ADMIN
============================ */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY
        ?.replace(/\\n/g, "\n")
        ?.replace(/"/g, ""),
    }),
  });
}

/* ============================
   APP SETUP
============================ */
const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://styledecor-client.firebaseapp.com",
      "https://style-decor-sever.vercel.app",
    ],
    credentials: true,
  })
);

app.use(express.json());

/* ============================
   DATABASE
============================ */
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_CLUSTER}/${process.env.DB_NAME}?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1 },
});

let db;
async function getDB() {
  if (!db) {
    await client.connect();
    db = client.db(process.env.DB_NAME);
  }
  return db;
}

/* ============================
   COLLECTIONS
============================ */
const usersCol = async () => (await getDB()).collection("users");
const bookingsCol = async () => (await getDB()).collection("bookings");
const decoratorsCol = async () => (await getDB()).collection("decorators");
const trackingsCol = async () => (await getDB()).collection("trackings");
const paymentsCol = async () => (await getDB()).collection("payments");
const servicesCol = async () => (await getDB()).collection("services");

/* ============================
   AUTH
============================ */
const verifyJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer "))
    return res.status(401).send({ message: "Unauthorized" });

  try {
    const token = authHeader.split(" ")[1];
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    res.status(403).send({ message: "Forbidden" });
  }
};

const verifyRole = role => async (req, res, next) => {
  const users = await usersCol();
  const user = await users.findOne({ email: req.user.email });

  if (!user || user.role !== role)
    return res.status(403).send({ message: "Access denied" });

  next();
};

/* ============================
   ROOT
============================ */
app.get("/", (req, res) => {
  res.send("🎨 StyleDecor Server is running");
});

/* ============================
   USERS
============================ */
app.post("/users", async (req, res) => {
  const users = await usersCol();
  const existing = await users.findOne({ email: req.body.email });

  if (existing) return res.send({ message: "User already exists" });

  await users.insertOne(req.body);
  res.send({ success: true });
});

app.get("/users", verifyJWT, verifyRole("admin"), async (req, res) => {
  const users = await usersCol();
  res.send(await users.find().toArray());
});

app.get("/users/role", verifyJWT, async (req, res) => {
  const users = await usersCol();
  const user = await users.findOne({ email: req.user.email });

  if (!user) return res.status(404).send({ message: "User not found" });

  res.send({ role: user.role });
});

/* ============================
   BOOKINGS
============================ */
app.post("/bookings", verifyJWT, async (req, res) => {
  const bookings = await bookingsCol();

  const booking = {
    ...req.body,
    userEmail: req.user.email, // 🔐 secure
    createdAt: new Date(),
  };

  const result = await bookings.insertOne(booking);

  if (!result.insertedId) {
    console.error("❌ Booking insert failed", booking);
    return res.status(500).send({ message: "Booking not saved" });
  }

  console.log("✅ Booking saved:", result.insertedId);

  res.send({
    success: true,
    bookingId: result.insertedId,
  });
});


app.get("/bookings/user", verifyJWT, async (req, res) => {
  const bookings = await bookingsCol();
  res.send(await bookings.find({ userEmail: req.user.email }).toArray());
});

app.get("/bookings", verifyJWT, verifyRole("admin"), async (req, res) => {
  const bookings = await bookingsCol();
  res.send(await bookings.find().toArray());
});

/* ============================
   PAYMENTS
============================ */
app.post("/payments", verifyJWT, async (req, res) => {
  const payments = await paymentsCol();
  const bookings = await bookingsCol();

  const {
    bookingId,
    amount,
    transactionId,
    trackingId,
    email,
    serviceType,
    region,
  } = req.body;

  await payments.insertOne({
    bookingId,
    amount,
    transactionId,
    trackingId,
    email,
    serviceType,
    region,
    createdAt: new Date(),
  });

  await bookings.updateOne(
    { _id: new ObjectId(bookingId) },
    { $set: { paymentStatus: "paid", transactionId } }
  );

  res.send({ success: true });
});

app.get("/payments", verifyJWT, async (req, res) => {
  const payments = await paymentsCol();
  res.send(await payments.find({ email: req.user.email }).toArray());
});

/* ============================
   DECORATORS
============================ */
app.get("/decorators/pending", verifyJWT, verifyRole("admin"), async (req, res) => {
  const decorators = await decoratorsCol();
  res.send(await decorators.find({ status: "pending" }).toArray());
});

app.get("/decorators", verifyJWT, verifyRole("admin"), async (req, res) => {
  const decorators = await decoratorsCol();
  res.send(await decorators.find({ status: "approved" }).toArray());
});

app.patch(
  "/decorators/approve/:id",
  verifyJWT,
  verifyRole("admin"),
  async (req, res) => {

    const decorators = await decoratorsCol();
    const users = await usersCol();

    // 1️⃣ Find decorator
    const decorator = await decorators.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!decorator) {
      return res.status(404).send({ message: "Decorator not found" });
    }

    // 2️⃣ Approve decorator
    await decorators.updateOne(
      { _id: decorator._id },
      { $set: { status: "approved" } }
    );

    // 3️⃣ UPDATE USER ROLE 🔥🔥🔥
    await users.updateOne(
      { email: decorator.email },
      { $set: { role: "decorator" } }
    );

    res.send({ success: true });
  }
);



/* ============================
   APPLY AS DECORATOR
============================ */
app.post("/decorators/apply", verifyJWT, async (req, res) => {
  const decorators = await decoratorsCol();

  const { name, email, phone, nid, experience } = req.body;

  // Check if already applied
  const existing = await decorators.findOne({ email });

  if (existing) {
    return res.status(400).send({
      message: "You have already applied as a decorator",
    });
  }

  const decoratorData = {
    name,
    email,
    phone,
    nid,
    experience,
    status: "pending",
    createdAt: new Date(),
  };

  await decorators.insertOne(decoratorData);

  res.send({ success: true });
});




/* ============================
   ASSIGN SERVICE (ADMIN)
============================ */
app.post("/services", verifyJWT, verifyRole("admin"), async (req, res) => {
  const services = await servicesCol();

  const {
    bookingId,
    serviceType,
    eventType,
    bookingDate,
    timeSlot,
    location,
    price,
    decoratorName,
    decoratorEmail,
    decoratorPhone,
  } = req.body;

  const existing = await services.findOne({ bookingId });

  if (existing) {
    return res.status(400).send({ message: "Service already assigned" });
  }

  const serviceData = {
    bookingId,
    serviceType,
    eventType,
    bookingDate,
    timeSlot,
    location,
    price,
    decoratorName,
    decoratorEmail,
    decoratorPhone,
    status: "Assigned", // ✅ normalized
    createdAt: new Date(),
  };

  await services.insertOne(serviceData);

  res.send({ success: true });
});



/* ============================
   SERVICES (ADMIN + DECORATOR)
============================ */
app.get("/services", verifyJWT, async (req, res) => {
  const services = await servicesCol();
  const users = await usersCol();

  const user = await users.findOne({ email: req.user.email });

  if (user.role === "admin") {
    return res.send(await services.find().toArray());
  }

  const result = await services.find({
    decoratorEmail: req.user.email,
  }).toArray();

  res.send(result);
});

/* ============================
   GENERATE TRACKING ID
============================ */
app.get("/services/:id/tracking", verifyJWT, async (req, res) => {
  const service = await servicesCol().then(col =>
    col.findOne({ _id: new ObjectId(req.params.id) })
  );

  if (!service) {
    return res.status(404).send({ message: "Service not found" });
  }

  const trackingId = `TRK-${Date.now().toString().slice(-6)}-${Math.floor(
    Math.random() * 1000
  )}`;

  res.send({ trackingId });
});






/* ============================
   UPDATE SERVICE STATUS
============================ */
app.patch("/services/:id", verifyJWT, async (req, res) => {
  const services = await servicesCol();
  const { status } = req.body;

  const service = await services.findOne({
    _id: new ObjectId(req.params.id),
  });

  if (!service) return res.status(404).send({ message: "Service not found" });

  const validTransitions = {
  Assigned: "Confirmed",
  Confirmed: "Completed",
};

if (validTransitions[service.status] !== status) {
  return res.status(400).send({ message: "Invalid status flow" });
}


  await services.updateOne(
    { _id: service._id },
    { $set: { status } }
  );

  res.send({ success: true });
});

/* ============================
   SERVICE CASHOUT
============================ */
app.post("/services/cashout/:id", verifyJWT, async (req, res) => {
  const services = await servicesCol();
  const payments = await paymentsCol();
  const trackings = await trackingsCol();

  const service = await services.findOne({
    _id: new ObjectId(req.params.id),
  });

  if (!service) return res.status(404).send({ message: "Service not found" });

  if (service.price && service.price > 0) {
    return res.status(400).send({ message: "Already cashed out" });
  }

  const payment = await payments.findOne({
    bookingId: service.bookingId,
  });

  if (!payment)
    return res.status(400).send({ message: "Payment not found" });

  const decoratorAmount = Number((payment.amount * 0.4).toFixed(2));

  await services.updateOne(
    { _id: service._id },
    {
      $set: {
        price: decoratorAmount,
        status: "Completed",
      },
    }
  );

  await trackings.insertOne({
    bookingId: service.bookingId,
    trackingNo: req.body.trackingNo,
    cost: decoratorAmount,
    status: "Completed",
    email: req.user.email,
    createdAt: new Date(),
  });

  res.send({ success: true });
});

/* ============================
   EXPORT
============================ */
module.exports = app;
