import express from "express";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { auth } from "./lib/auth.js";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const port = process.env.PORT || 3005;

app.use(
    cors({
        origin: process.env.FRONTEND_URL || "http://localhost:3000", // Replace with your frontend's origin
        methods: ["GET", "POST", "PUT", "DELETE"], // Specify allowed HTTP methods
        credentials: true, // Allow credentials (cookies, authorization headers, etc.)
    })
);

app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

app.get("/api/me", async (req, res) => {
    const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
    });
    return res.json(session);
});

app.get("/device", async (req, res) => {
    // const { user_code } = req.query;
    res.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}/device`);
})


app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});