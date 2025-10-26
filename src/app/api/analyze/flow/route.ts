import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

interface GenerateFlowRequest {
  context: string;
  presentational?: boolean;
  sectionsMin?: number; // desired min number of body sections (excluding intro/conclusion/qa)
  sectionsMax?: number; // desired max number of body sections
}

type RawFlowSection = { title?: string; goals?: string[] };
type RawFlow = {
  intro?: RawFlowSection;
  sections?: RawFlowSection[];
  conclusion?: RawFlowSection;
  qa?: RawFlowSection;
};

export async function POST(request: NextRequest) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Gemini API key not configured. Please set GEMINI_API_KEY in environment variables." },
        { status: 500 }
      );
    }

    const body = (await request.json()) as GenerateFlowRequest;
    const {
      context,
      presentational = true,
      sectionsMin = 2,
      sectionsMax = 4,
    } = body || {};

    if (!context || typeof context !== "string") {
      return NextResponse.json({ error: "'context' is required" }, { status: 400 });
    }
    const min = clamp(Math.max(1, Math.floor(sectionsMin)), 1, 8);
    const max = clamp(Math.max(min, Math.floor(sectionsMax)), min, 10);

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const instructions = `You are an expert presentation coach.
Given the CONTEXT, produce a clean, concise presentation flow with an intro, ${min}–${max} body sections, a conclusion, and a short Q&A plan.

Rules:
- Each unit has: { "title": string (<= 80 chars), "goals": string[] with 2–4 short bullets (<= 100 chars each) }.
- Sections should be audience-appropriate and non-overlapping; use clear transitions implicitly by section ordering.
- ${presentational ? "This is a presentational scenario. Emphasize clarity, scaffolding, and logical structure." : "This is an interactive scenario. Keep the structure brief and flexible."}
- Return ONLY valid JSON with shape: { "flow": { "intro": {...}, "sections": RawFlowSection[], "conclusion": {...}, "qa": {...} } }.

CONTEXT:\n${context}`;

    const result = await model.generateContent([instructions]);
    const response = await result.response;
    const text = response.text();

    const parsed = safeParseFlow(text);
    if (!parsed) {
      return NextResponse.json(
        { error: "Failed to parse flow from model output.", raw: text?.slice(0, 1000) },
        { status: 502 }
      );
    }

    // Normalize, fill IDs, clamp sizes, and ensure minimal structure.
    const normalized = normalizeFlow(parsed);
    // Enforce number of sections within the requested range by trimming or padding placeholders.
    if (normalized.sections.length > max) normalized.sections = normalized.sections.slice(0, max);
    if (normalized.sections.length < min) {
      const needed = min - normalized.sections.length;
      for (let i = 0; i < needed; i++) {
        normalized.sections.push(blankSection(`Section ${normalized.sections.length + 1}`));
      }
    }

    return NextResponse.json({ flow: normalized, meta: { model: "gemini-2.0-flash-exp" } });
  } catch (error: any) {
    console.error("Error in flow API route:", error);
    return NextResponse.json(
      { error: `Failed to generate flow: ${error?.message || "Unknown error"}` },
      { status: 500 }
    );
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function stripCodeFences(s: string): string {
  return s.replace(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/m, "$1");
}

function safeParseFlow(text: string | undefined | null): RawFlow | null {
  if (!text) return null;
  const cleaned = stripCodeFences(text.trim());
  try {
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj === "object") {
      if ((obj as any).flow) return (obj as any).flow as RawFlow;
      return obj as RawFlow;
    }
  } catch {}

  // Try to extract inner object by braces, as models sometimes add prose
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const objStr = cleaned.slice(start, end + 1);
    try {
      const obj = JSON.parse(objStr);
      if (obj && typeof obj === "object") {
        if ((obj as any).flow) return (obj as any).flow as RawFlow;
        return obj as RawFlow;
      }
    } catch {}
  }
  return null;
}

function normalizeFlow(raw: RawFlow) {
  const normSection = (s?: RawFlowSection, fallbackTitle?: string) => {
    const title = (s?.title || fallbackTitle || "").toString().trim().slice(0, 120) || fallbackTitle || "Section";
    const goals = (Array.isArray(s?.goals) ? s!.goals : [])
      .map((g) => (typeof g === "string" ? g : String(g)))
      .map((g) => g.trim())
      .filter(Boolean)
      .slice(0, 6)
      .map((g) => g.slice(0, 140));
    return { id: randomUUID(), title, goals: goals.length ? goals : ["State the objective", "Set audience expectations"] };
  };

  const intro = normSection(raw.intro, "Introduction");
  const sections = Array.isArray(raw.sections) && raw.sections.length
    ? raw.sections.map((s, idx) => normSection(s, `Section ${idx + 1}`))
    : [blankSection("Section 1"), blankSection("Section 2")];
  const conclusion = normSection(raw.conclusion, "Conclusion");
  const qa = normSection(raw.qa, "Q&A");
  return { intro, sections, conclusion, qa };
}

function blankSection(title: string) {
  return { id: randomUUID(), title, goals: ["Add a brief goal", "Add another brief goal"] };
}
