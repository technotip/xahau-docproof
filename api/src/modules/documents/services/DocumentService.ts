import { DocumentStatus } from "@/enums/DocumentStatus";
import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from "@/exceptions";
import UserDocument, {
  IUserDocument,
  Signer,
} from "@/modules/documents/models/UserDocument";
import crypto from "crypto";
import fs from "fs";
import mongoose from "mongoose";
import path from "path";
import { NotificationService } from "./NotificationService";

export class DocumentService {
  static getDocuments = async (wallet: string): Promise<IUserDocument[]> => {
    if (!wallet) {
      throw new BadRequestException("Owner wallet is required");
    }

    const documents: IUserDocument[] = await UserDocument.find({
      owner: wallet,
    })
      // .select(
      //   "-signedSigners"
      // )
      .sort({ createdAt: -1 });

    return documents;
  };

  static updateDocumentStatus = async (
    documentId: string,
    newStatus: DocumentStatus
  ): Promise<IUserDocument | null> => {
    if (!documentId) {
      throw new BadRequestException("Document ID is required.");
    }

    if (!mongoose.Types.ObjectId.isValid(documentId)) {
      throw new BadRequestException("Invalid document ID format.");
    }

    const document = await UserDocument.findById(documentId);

    if (!document) {
      throw new HttpException(404, "Document not found.");
    }

    const validTransitions: Record<DocumentStatus, DocumentStatus[]> = {
      [DocumentStatus.Pending]: [
        DocumentStatus.Rejected,
      ],
      [DocumentStatus.AwaitingSignatures]: [
        DocumentStatus.PartiallySigned,
        DocumentStatus.FullySigned,
      ],
      [DocumentStatus.PartiallySigned]: [
        DocumentStatus.FullySigned,
        DocumentStatus.Rejected,
      ],
      [DocumentStatus.FullySigned]: [],
      [DocumentStatus.Rejected]: [],
      [DocumentStatus.Archived]: [],
    };

    const currentStatus = document.status;

    // if (validTransitions[currentStatus]?.includes(newStatus)) {
    document.status = newStatus;

    await document.save();

    return document;
  };

  static getDocumentById = async (documentId: string): Promise<any> => {
    if (!mongoose.Types.ObjectId.isValid(documentId)) {
      throw new BadRequestException("Invalid document ID format.");
    }

    const document = await UserDocument.findById(documentId);
    if (!document) {
      throw new HttpException(404, "Document not found");
    }

    const {
      id,
      hash,
      name,
      size,
      extension,
      owner,
      status,
      expirationTime,
      signers,
    } = document;

    return {
      id,
      hash,
      name,
      size,
      extension,
      owner,
      status,
      expirationTime,
      signers,
    };
  };

  static saveAndNotifySigners = async (
    documentId: string,
    signers: string[]
  ): Promise<any> => {
    if (!mongoose.Types.ObjectId.isValid(documentId)) {
      throw new BadRequestException("Invalid document ID format.");
    }

    if (!Array.isArray(signers) || signers.length === 0) {
      throw new HttpException(400, "Invalid signers list or empty.");
    }

    const document = await UserDocument.findById(documentId);
    if (!document) {
      throw new NotFoundException("Document not found");
    }

    for (const email of signers) {
      const signer = new Signer({
        email,
        status: false,
      });
      document.signers.push(signer);
    }

    const notificationService = new NotificationService();
    await notificationService.notifySignersForReview(document);

    document.status = DocumentStatus.AwaitingSignatures;
    await document.save();

    return document.signers;
  };

  static createDocument = async (req: any): Promise<any> => {
    if (!req.file) {
      throw new BadRequestException("File is required.");
    }

    const hash = crypto.createHash("sha256");
    hash.update(req.file.buffer);
    const fileHash = hash.digest("hex");

    const ext = path.extname(req.file.originalname);
    const filename = `${fileHash}${ext}`;

    const filePath = path.join("storage", filename);
    fs.writeFileSync(filePath, req.file.buffer);

    const expirationTime = new Date(Date.now() + 20 * (24 * 60 * 60 * 1000));

    const originalFilename = Buffer.from(
      req.file.originalname,
      "latin1"
    ).toString("utf8");

    const newDocument = new UserDocument({
      hash: fileHash,
      name: originalFilename,
      size: req.file.size,
      extension: ext,
      signers: req.body.signers || [],
      expirationTime,
      owner: req.user.sub,
    });

    await newDocument.save();

    return newDocument;
  };
}
