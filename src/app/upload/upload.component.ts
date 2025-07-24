import { Component, OnInit } from "@angular/core";
import {
  HttpClient,
} from "@angular/common/http";

@Component({
  selector: "app-upload",
  templateUrl: "./upload.component.html",
  styleUrls: ["./upload.component.css"],
})
export class UploadComponent implements OnInit {
  file: File | null = null;
  progress = 0;
  log: string[] = [];
  finishedUploads: any[] = [];
  incompleteUploads: any[] = [];
  uploadId: string | null = null;
  paused = false;
  currentChunkIndex = 0;
  CHUNK_SIZE = 100 * 1024 * 1024;
  activeResumeSession: { session: any; uploadedChunks: number[] } | null = null;
  downloadProgress: { [sessionId: string]: number } = {};

  constructor(
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.loadIncompleteSessions();
    this.loadFinishedSessions();
  }

  async loadFinishedSessions() {
    this.finishedUploads = await this.http
      .get<any[]>("/upload/finished")
      .toPromise();
  }

  async loadIncompleteSessions() {
    try {
      this.incompleteUploads = await this.http
        .get<any[]>("/upload/unfinished")
        .toPromise();
    } catch (err) {
      console.error("Failed to load unfinished sessions", err);
    }
  }

  onFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.file = target.files?.[0] ?? null;

    if (
      this.file &&
      this.activeResumeSession &&
      this.file.name === this.activeResumeSession.session.fileName
    ) {
      this.log.push(`✅ File reselected. Resuming...`);
      this.uploadChunks(
        this.activeResumeSession.session.id,
        this.file,
        0,
        this.activeResumeSession.uploadedChunks
      );
      this.uploadId = this.activeResumeSession.session.id;
      this.activeResumeSession = null;
    }
  }

  pauseUpload(): void {
    this.paused = true;
    this.log.push("⏸ Upload paused");
  }

  resumeUpload(): void {
    this.paused = false;
    if (this.uploadId && this.file) {
      this.log.push("▶️ Resuming upload...");
      this.uploadChunks(this.uploadId, this.file, this.currentChunkIndex);
    }
  }

  async startUpload(): Promise<void> {
    if (!this.file) return;

    this.progress = 0;
    this.paused = false;
    this.log = [];

    const initRes = await this.http
      .post<any>(
        `/upload/init?fileName=${encodeURIComponent(
          this.file.name
        )}&totalSize=${this.file.size}`,
        {}
      )
      .toPromise();

    this.uploadId = initRes.uploadId || initRes.id;
    this.currentChunkIndex = 0;

    await this.uploadChunks(this.uploadId, this.file, this.currentChunkIndex);
  }

  async uploadChunks(
    uploadId: string,
    file: File,
    fromChunk: number,
    knownUploadedChunks: number[] = []
  ) {
    const totalChunks = Math.ceil(file.size / this.CHUNK_SIZE);

    const uploadedChunks: number[] = knownUploadedChunks.length
      ? knownUploadedChunks
      : await this.http
          .get<number[]>(`/upload/${uploadId}/uploadedChunks`)
          .toPromise();

    for (let i = fromChunk; i < totalChunks; i++) {
      if (this.paused) {
        this.currentChunkIndex = i;
        return;
      }

      if (uploadedChunks.includes(i)) {
        this.log.push(`⏩ Skipping chunk ${i + 1}`);
        continue;
      }

      const start = i * this.CHUNK_SIZE;
      const end = Math.min(start + this.CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      const formData = new FormData();
      formData.append("chunkIndex", i.toString());
      formData.append("chunk", chunk);

      await this.http
        .patch(`/upload/${uploadId}/chunk`, formData, {
          responseType: "text",
        })
        .toPromise();

      this.progress = Math.floor(((i + 1) / totalChunks) * 100);
      this.log.push(`✅ Uploaded chunk ${i + 1} / ${totalChunks}`);
    }

    await this.http.post(`/upload/${uploadId}/complete`, {}).toPromise();
    this.log.push("🎉 Upload complete!");
    this.uploadId = null;
    this.currentChunkIndex = 0;
  }

  async resumeOldSession(session: any) {
    this.uploadId = session.id;
    this.currentChunkIndex = 0;

    const uploadedChunks: number[] = await this.http
      .get<number[]>(`/upload/${this.uploadId}/uploadedChunks`)
      .toPromise();

    this.progress = Math.floor(
      (uploadedChunks.length / Math.ceil(session.totalSize / this.CHUNK_SIZE)) *
        100
    );

    this.log.push(`📂 Loaded session for file: ${session.fileName}`);

    if (this.file && this.file.name === session.fileName) {
      this.log.push(`▶️ Resuming upload with selected file: ${this.file.name}`);
      this.uploadChunks(
        this.uploadId,
        this.file,
        this.currentChunkIndex,
        uploadedChunks
      );
    } else {
      this.log.push(
        `⚠️ File not selected or mismatch. Please reselect: ${session.fileName}`
      );
      this.activeResumeSession = {
        session,
        uploadedChunks,
      };

      const fileInput = document.getElementById(
        "fileInput"
      ) as HTMLInputElement;
      if (fileInput) fileInput.value = "";
    }
  }

  downloadZip(sessionId: string): void {
    const zipUrl = `http://localhost:8080/download/${sessionId}/zip`;
    window.open(zipUrl, "_blank");
  }


  download(sessionId: string, fileName: string): void {
    const backendUrl = `http://localhost:8080/download/${sessionId}`;
    window.open(backendUrl, "_blank");
  }
}
