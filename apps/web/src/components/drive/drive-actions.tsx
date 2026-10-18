'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { DocumentTypeView, DriveSettingsView } from '@crm/shared';
import type { UploadTarget } from '@/lib/upload';
import { Button } from '../ui';
import { IconFolder, IconUpload } from '../icons';
import { DropZone } from './drop-zone';
import { FolderDialog } from './dialogs';

/** "New folder" and "Upload" for wherever the drive is open. */
export function DriveActions({
  folderParent,
  uploadTarget,
  canManage,
  canUpload,
  manager,
  types,
  settings,
}: {
  folderParent: { parentId?: string | null; clientId?: string | null } | null;
  uploadTarget: UploadTarget | null;
  canManage: boolean;
  canUpload: boolean;
  manager: boolean;
  types: DocumentTypeView[];
  settings: DriveSettingsView;
}) {
  const router = useRouter();
  const [folder, setFolder] = useState(false);
  const [upload, setUpload] = useState(false);
  return (
    <div className="mb-4">
      <div className="flex flex-wrap gap-2">
        {canManage && folderParent && (
          <Button size="sm" variant="secondary" onClick={() => setFolder(true)}>
            <IconFolder size={15} />
            New folder
          </Button>
        )}
        {canUpload && uploadTarget && (
          <Button size="sm" onClick={() => setUpload((v) => !v)} aria-expanded={upload}>
            <IconUpload size={15} />
            {upload ? 'Close upload' : 'Upload'}
          </Button>
        )}
      </div>
      {upload && uploadTarget && (
        <div className="mt-3">
          <DropZone target={uploadTarget} types={types} acceptedTypes={settings.acceptedTypes} maxFileMb={settings.maxFileMb} compact />
        </div>
      )}
      <FolderDialog open={folder} onClose={() => setFolder(false)} onSaved={() => router.refresh()} parent={folderParent ?? undefined} manager={manager} />
    </div>
  );
}
