import { arrayRemove, arrayUnion, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { db, storage } from './firebase';
import {
  attachmentPath,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type Attachment,
  type GraphNode,
} from './model';

// Files attached to nodes: the bytes go to Cloud Storage, the metadata to the node's `attachments`
// list. Unlike the other writes, uploads need a connection.

/** Returns an error message if `files` can't be attached to `node`. */
export function attachError(node: GraphNode, files: File[]): string | null {
  if (node.attachments.length + files.length > MAX_ATTACHMENTS) {
    return `A node can have at most ${MAX_ATTACHMENTS} attachments`;
  }
  const big = files.find((f) => f.size > MAX_ATTACHMENT_BYTES);
  if (big) return `"${big.name}" is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}`;
  return null;
}

/** Uploads a file and adds it to the node; `onProgress` gets 0…1. */
export async function uploadAttachment(
  me: string,
  nodeId: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const id = doc(collection(db, 'nodes')).id;
  const contentType = file.type || 'application/octet-stream';
  const task = uploadBytesResumable(ref(storage, attachmentPath(nodeId, id)), file, {
    contentType,
    // Keeps the original name when the file is downloaded.
    contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    customMetadata: { uploadedBy: me },
  });
  task.on('state_changed', (s) => onProgress(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0));
  await task;
  const attachment: Attachment = {
    id,
    name: file.name.slice(0, 500) || 'file',
    size: file.size,
    contentType,
    uploadedBy: me,
    uploadedAt: Date.now(),
  };
  await updateDoc(doc(db, 'nodes', nodeId), {
    attachments: arrayUnion(attachment),
    updatedBy: me,
    updatedAt: serverTimestamp(),
  });
}

export function attachmentUrl(nodeId: string, attachment: Attachment): Promise<string> {
  return getDownloadURL(ref(storage, attachmentPath(nodeId, attachment.id)));
}

/** Deletes stored files, ignoring ones that are already gone. */
export async function deleteAttachmentFiles(nodeId: string, attachments: Attachment[]) {
  await Promise.all(
    attachments.map((a) =>
      deleteObject(ref(storage, attachmentPath(nodeId, a.id))).catch((err) => {
        if (err?.code !== 'storage/object-not-found') console.error(err);
      }),
    ),
  );
}

export async function removeAttachment(me: string, nodeId: string, attachment: Attachment) {
  await updateDoc(doc(db, 'nodes', nodeId), {
    attachments: arrayRemove(attachment),
    updatedBy: me,
    updatedAt: serverTimestamp(),
  });
  await deleteAttachmentFiles(nodeId, [attachment]);
}
