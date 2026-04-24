import { useState } from "react";
import { uploadDocumentFile, uploadImageFile } from "../services/api.js";

export function useFileUpload() {
  const [uploadState, setUploadState] = useState({
    loading: false,
    kind: "",
    message: "",
  });

  async function uploadDocument(file, userId) {
    setUploadState({
      loading: true,
      kind: "document",
      message: "",
    });

    try {
      const result = await uploadDocumentFile(file, userId);
      setUploadState({
        loading: false,
        kind: "",
        message: "Document uploaded. You can now send your question with it.",
      });
      return result;
    } catch (error) {
      setUploadState({
        loading: false,
        kind: "",
        message: error.message,
      });
      throw error;
    }
  }

  async function uploadImage(file) {
    setUploadState({
      loading: true,
      kind: "image",
      message: "",
    });

    try {
      const result = await uploadImageFile(file);
      setUploadState({
        loading: false,
        kind: "",
        message: "Image uploaded. Ask a question about it now.",
      });
      return result;
    } catch (error) {
      setUploadState({
        loading: false,
        kind: "",
        message: error.message,
      });
      throw error;
    }
  }

  return {
    uploadDocument,
    uploadImage,
    uploadState,
  };
}
