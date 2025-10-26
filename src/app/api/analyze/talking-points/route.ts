import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

interface GeneratePointsRequest {
  context: string;
  presentational?: boolean;
  countMin?: number;
  countMax?: number;
}

type RawPoint = { text: string; importance: number };

export async function POST(request: NextRequest) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Gemini API key not configured. Please set GEMINI_API_KEY in environment variables." },
        { status: 500 }
      );
    }

    const body = (await request.json()) as GeneratePointsRequest;
    const {
      context,
      presentational = false,
      countMin = 8,
      countMax = 15,
    } = body || {};

    if (!context || typeof context !== "string") {
      return NextResponse.json({ error: "'context' is required" }, { status: 400 });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const instructions = `You are an expert speech coach.
Given the CONTEXT, produce ${countMin}–${countMax} analytical questions with importance weights.

Rules:
- Each point: { "text": string (<= 140 chars), "importance": integer 1-5 }.
- Importance 5 = must-cover; 1 = nice-to-have.
- Avoid duplicates; combine overlapping ideas; keep language audience-appropriate.
- ${presentational ? "This is a presentational scenario. Prioritize an arc: objective, key sections, transitions, and conclusion." : "This is an interactive scenario. Prioritize goal-oriented, conversational points and checkpoints."}
- Return ONLY valid JSON with shape: { "points": RawPoint[] }.

CONTEXT:
${context}`;

    const result = await model.generateContent([instructions]);
    const response = await result.response;
    const text = response.text();

    const parsed = safeParsePoints(text);
    if (!parsed) {
      return NextResponse.json(
        { error: "Failed to parse talking points from model output.", raw: text?.slice(0, 1000) },
        { status: 502 }
      );
    }

    const normalized = parsed
      .filter((p) => p && typeof p.text === "string" && p.text.trim().length > 0)
      .map((p) => ({
        id: randomUUID(),
        text: p.text.trim().slice(0, 200),
        importance: clamp(Math.round(Number(p.importance) || 3), 1, 5),
      }));

    let points = normalized;
    if (points.length > countMax) points = points.slice(0, countMax);
    if (points.length < countMin) {
      const needed = countMin - points.length;
      for (let i = 0; i < needed; i++) {
        points.push({ id: randomUUID(), text: "(Add a key point)", importance: 3 });
      }
    }

    return NextResponse.json({ points, meta: { model: "gemini-2.0-flash-exp", count: points.length } });
  } catch (error: any) {
    console.error("Error in talking-points API route:", error);
    return NextResponse.json(
      { error: `Failed to generate talking points: ${error?.message || "Unknown error"}` },
      { status: 500 }
    );
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeParsePoints(text: string | undefined | null): RawPoint[] | null {
  if (!text) return null;
  const cleaned = stripCodeFences(text.trim());
  try {
    const obj = JSON.parse(cleaned);
    if (Array.isArray(obj)) return obj as RawPoint[];
    if (obj && Array.isArray((obj as any).points)) return (obj as any).points as RawPoint[];
  } catch {}

  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    const arrStr = cleaned.slice(start, end + 1);
    try {
      return JSON.parse(arrStr) as RawPoint[];
    } catch {}
  }

  const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length) {
    const points: RawPoint[] = [];
    for (const line of lines) {
      const m = line.match(/^[-*\d.)\s]*([^()\-•]+?)(?:\s*[\(\[]?(\d)\)?\]?)?\s*$/);
      if (m) {
        const textVal = m[1].trim();
        const imp = m[2] ? Number(m[2]) : 3;
        if (textVal) points.push({ text: textVal, importance: clamp(imp, 1, 5) });
      }
    }
    if (points.length) return points;
  }
  return null;
}

function stripCodeFences(s: string): string {
  return s.replace(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/m, "$1");
}
