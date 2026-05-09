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

app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "wemiy-auth-api" });
});

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


app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
});

app.use((err, _req, res, _next) => {
    console.error(err);
    const status = Number(err?.status) || 500;
    res.status(status).json({
        error: status === 500 ? "Internal server error" : err.message || "Error",
    });
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});