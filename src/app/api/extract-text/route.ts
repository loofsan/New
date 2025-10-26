import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function POST(request: NextRequest) {
  try {
    // Check if API key is configured
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Gemini API key not configured. Please set GEMINI_API_KEY in environment variables." },
        { status: 500 }
      );
    }

    const form = await request.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "A 'file' field is required" },
        { status: 400 }
      );
    }

    const filename = (file as File).name || "upload.file";
    const contentType = (file as File).type || "";

    // Check supported file types
    const isPdf = contentType === "application/pdf" || /\.pdf$/i.test(filename);
    const isPptx = contentType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || /\.pptx$/i.test(filename);
    const isImage = contentType.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp)$/i.test(filename);
    const isText = contentType.startsWith("text/") || /\.(txt|md|csv)$/i.test(filename);

    // For text files, just read directly
    if (isText) {
      const text = await file.text();
      return NextResponse.json({
        text,
        meta: {
          pages: 1,
          chars: text.length,
          fileType: 'text'
        },
      });
    }

    // For other file types, use Gemini API
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      
      // Get the appropriate model - using Gemini 2.0 Flash (latest available)
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash-exp" // Latest Gemini Flash model
      });

      // Prepare the file for Gemini
      const base64Data = Buffer.from(bytes).toString('base64');
      
      let mimeType = contentType;
      if (!mimeType) {
        // Infer MIME type from extension if not provided
        if (isPdf) mimeType = "application/pdf";
        else if (isPptx) mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        else if (/\.png$/i.test(filename)) mimeType = "image/png";
        else if (/\.jpe?g$/i.test(filename)) mimeType = "image/jpeg";
        else mimeType = "application/octet-stream";
      }

      // Create the prompt based on file type
      let prompt = "";
      if (isPdf || isPptx) {
        prompt = `Please extract and return ALL the text content from this document. 
                  Include all slides, pages, headers, bullet points, and any text visible in the document.
                  If there are images with text, describe them briefly.
                  Format the output as plain text, maintaining the document's structure with clear separations between sections/slides.
                  Do not summarize - extract everything.`;
      } else if (isImage) {
        prompt = `Please extract any text visible in this image. 
                  If there is no text, describe what you see in the image.
                  If there are charts or diagrams, describe their content.`;
      } else {
        prompt = `Please extract and return all text content from this file.`;
      }

      // Call Gemini API
      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Data
          }
        }
      ]);

      const response = await result.response;
      const extractedText = response.text();

      // Estimate pages (rough approximation)
      const estimatedPages = isPdf || isPptx ? Math.max(1, Math.ceil(extractedText.length / 3000)) : 1;

      return NextResponse.json({
        text: extractedText,
        meta: {
          pages: estimatedPages,
          chars: extractedText.length,
          fileType: isPdf ? 'pdf' : isPptx ? 'pptx' : isImage ? 'image' : 'other',
          processedBy: 'gemini-2.0-flash-exp'
        },
      });

    } catch (geminiError: any) {
      console.error("Gemini API error:", geminiError);
      
      // Provide more specific error messages
      if (geminiError.message?.includes("API key")) {
        return NextResponse.json(
          { error: "Invalid Gemini API key. Please check your GEMINI_API_KEY environment variable." },
          { status: 401 }
        );
      } else if (geminiError.message?.includes("quota")) {
        return NextResponse.json(
          { error: "Gemini API quota exceeded. Please try again later." },
          { status: 429 }
        );
      } else if (geminiError.message?.includes("File too large")) {
        return NextResponse.json(
          { error: "File is too large for processing. Please use a smaller file." },
          { status: 413 }
        );
      }
      
      return NextResponse.json(
        { error: `Failed to process document with Gemini: ${geminiError.message || 'Unknown error'}` },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error("Error in extract-text API route:", error);
    return NextResponse.json(
      { error: "Failed to extract text from document" },
      { status: 500 }
    );
  }
}