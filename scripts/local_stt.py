import io

import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

app = FastAPI()
whisper = WhisperModel("small", device="cpu", compute_type="int8")


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form("small"),
    language: str | None = Form(None),
    prompt: str | None = Form(None),
):
    audio = await file.read()
    segments, _ = whisper.transcribe(
        io.BytesIO(audio), language=language, initial_prompt=prompt
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    return JSONResponse({"text": text})


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
