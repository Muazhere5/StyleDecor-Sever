const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
require("dotenv").config();
/* ============================
   APP CONFIG
============================ */
const app = express();
app.use(cors());
app.use(express.json());