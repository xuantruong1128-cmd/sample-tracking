import React, { useState, useEffect, useCallback } from 'react';
import type { OperationSamplePhoto } from '../../types/database.types';
import { useAuth } from '../auth/AuthContext';
import {
  fetchSamplePhotos,
  uploadSamplePhoto,
  deleteSamplePhoto,
  viewSamplePhotoSignedUrl,
} from '../../services/samplePhotoService';
import {
  Camera,
  Image as ImageIcon,
  Loader2,
  Trash2,
  X,
  ExternalLink,
  Plus,
  AlertCircle,
  Eye,
} from 'lucide-react';

interface OperationSamplePhotosGalleryProps {
  jobId: string;
  operationId: string;
  jobStatus: string;
}

export const OperationSamplePhotosGallery: React.FC<OperationSamplePhotosGalleryProps> = ({
  jobId,
  operationId,
  jobStatus,
}) => {
  const { profile } = useAuth();
  const role = profile?.role || 'PE-MFG';
  const isJobClosed = jobStatus === 'CLOSE' || jobStatus === 'PURGED';
  // Allowed to upload/delete if PE-MFG or Admin, provided parent JOB is not closed
  const canManagePhotos = !isJobClosed && (role === 'PE-MFG' || role === 'Admin');

  const [photos, setPhotos] = useState<OperationSamplePhoto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [uploading, setUploading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Lightbox modal state
  const [previewPhoto, setPreviewPhoto] = useState<OperationSamplePhoto | null>(null);
  const [previewSignedUrl, setPreviewSignedUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Thumbnail signed URLs cache: { [filePath]: signedUrl }
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    const { photos: data, error } = await fetchSamplePhotos(operationId);
    if (error) {
      setErrorMsg(error);
    } else {
      setPhotos(data);
      // Fetch signed URLs for thumbnails
      data.forEach(async (p) => {
        const { signedUrl } = await viewSamplePhotoSignedUrl(p.file_path);
        if (signedUrl) {
          setThumbnailUrls((prev) => ({ ...prev, [p.file_path]: signedUrl }));
        }
      });
    }
    setLoading(false);
  }, [operationId]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setErrorMsg(null);
    const { photo, error } = await uploadSamplePhoto({
      jobId,
      operationId,
      file,
    });
    setUploading(false);

    if (error || !photo) {
      setErrorMsg(error || 'Không thể tải ảnh lên.');
    } else {
      setPhotos((prev) => [photo, ...prev]);
      // Cache signed URL for the new photo
      const { signedUrl } = await viewSamplePhotoSignedUrl(photo.file_path);
      if (signedUrl) {
        setThumbnailUrls((prev) => ({ ...prev, [photo.file_path]: signedUrl }));
      }
    }
  };

  const handleDelete = async (photo: OperationSamplePhoto) => {
    if (!window.confirm(`Xác nhận xóa ảnh mẫu "${photo.file_name}"?`)) {
      return;
    }
    const { success, error } = await deleteSamplePhoto(photo.id, photo.file_path);
    if (!success || error) {
      setErrorMsg(error || 'Không thể xóa ảnh.');
    } else {
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      if (previewPhoto?.id === photo.id) {
        setPreviewPhoto(null);
        setPreviewSignedUrl(null);
      }
    }
  };

  const handleOpenLightbox = async (photo: OperationSamplePhoto) => {
    setPreviewPhoto(photo);
    setPreviewError(null);

    // If already in thumbnail cache, reuse
    if (thumbnailUrls[photo.file_path]) {
      setPreviewSignedUrl(thumbnailUrls[photo.file_path]);
      return;
    }

    setPreviewLoading(true);
    const { signedUrl, error } = await viewSamplePhotoSignedUrl(photo.file_path);
    setPreviewLoading(false);

    if (error || !signedUrl) {
      setPreviewError(error || 'Không thể tải ảnh xem trước.');
    } else {
      setPreviewSignedUrl(signedUrl);
      setThumbnailUrls((prev) => ({ ...prev, [photo.file_path]: signedUrl }));
    }
  };

  return (
    <div className="h-full flex flex-col justify-between p-3 bg-slate-50/70 border border-slate-200/80 rounded-lg">
      <div>
        <div className="flex items-center justify-between pb-2 border-b border-slate-200/70">
          <div className="flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wide">
              Ảnh sản phẩm mẫu (Sample Photos)
            </span>
          </div>
          <span className="text-[10px] font-bold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
            {photos.length} ảnh
          </span>
        </div>

        {errorMsg && (
          <div className="mt-2 p-2 bg-rose-50 border border-rose-200 rounded text-rose-800 text-[11px] flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Thumbnail Grid */}
        <div className="mt-2.5">
          {loading ? (
            <div className="py-6 flex flex-col items-center justify-center gap-1.5 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              <span className="text-[11px]">Đang tải ảnh mẫu...</span>
            </div>
          ) : photos.length === 0 ? (
            <div className="py-4 px-2 text-center text-slate-400 text-xs italic bg-white rounded border border-dashed border-slate-200">
              Chưa có ảnh sản phẩm mẫu cho công đoạn này.
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {photos.map((p) => {
                const url = thumbnailUrls[p.file_path];
                return (
                  <div
                    key={p.id}
                    className="group relative aspect-square bg-slate-100 rounded-lg border border-slate-200 overflow-hidden shadow-2xs hover:shadow-sm transition"
                  >
                    {url ? (
                      <img
                        src={url}
                        alt={p.file_name}
                        onClick={() => handleOpenLightbox(p)}
                        className="w-full h-full object-cover cursor-pointer hover:scale-105 transition duration-200"
                      />
                    ) : (
                      <div
                        onClick={() => handleOpenLightbox(p)}
                        className="w-full h-full flex flex-col items-center justify-center cursor-pointer text-slate-400 hover:text-blue-600"
                      >
                        <ImageIcon className="w-5 h-5" />
                        <span className="text-[9px] mt-0.5">Xem</span>
                      </div>
                    )}

                    {/* Quick overlay buttons */}
                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 pointer-events-none group-hover:pointer-events-auto">
                      <button
                        type="button"
                        onClick={() => handleOpenLightbox(p)}
                        className="p-1 rounded bg-white/90 text-slate-800 hover:bg-white hover:text-blue-600 shadow-xs"
                        title="Phóng to ảnh"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {canManagePhotos && (
                        <button
                          type="button"
                          onClick={() => handleDelete(p)}
                          className="p-1 rounded bg-white/90 text-slate-800 hover:bg-white hover:text-rose-600 shadow-xs"
                          title="Xóa ảnh"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Timestamp & Uploader badge */}
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-1 pointer-events-none">
                      <p className="text-[9px] text-white truncate font-medium">{p.uploader_name}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Upload Controls */}
      {canManagePhotos && (
        <div className="pt-2 mt-2 border-t border-slate-200/70 flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-500 italic">
            JPG, PNG, WebP (Tối đa 10MB)
          </span>
          <div className="flex items-center gap-1.5">
            {/* 1. Camera Direct Capture */}
            <label
              className={`cursor-pointer inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-2xs ${
                uploading ? 'opacity-50 pointer-events-none' : ''
              }`}
              title="Chụp trực tiếp bằng máy ảnh điện thoại"
            >
              {uploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Camera className="w-3.5 h-3.5" />
              )}
              <span>Chụp ảnh</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileUpload(e.target.files[0]);
                    e.target.value = '';
                  }
                }}
              />
            </label>

            {/* 2. Choose File from Disk */}
            <label
              className={`cursor-pointer inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 hover:text-blue-600 transition shadow-2xs ${
                uploading ? 'opacity-50 pointer-events-none' : ''
              }`}
              title="Chọn ảnh từ thiết bị"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Chọn ảnh</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileUpload(e.target.files[0]);
                    e.target.value = '';
                  }
                }}
              />
            </label>
          </div>
        </div>
      )}

      {/* LIGHTBOX MODAL */}
      {previewPhoto && (
        <div
          data-testid="sample-photo-lightbox"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/75 backdrop-blur-xs"
          onClick={() => {
            setPreviewPhoto(null);
            setPreviewSignedUrl(null);
          }}
        >
          <div
            className="bg-white rounded-xl max-w-2xl w-full p-4 shadow-2xl border border-slate-200 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-blue-600" />
                <div>
                  <h4 className="text-xs font-bold text-slate-900">{previewPhoto.file_name}</h4>
                  <p className="text-[10px] text-slate-500">
                    Người chụp: <strong>{previewPhoto.uploader_name}</strong> •{' '}
                    {new Date(previewPhoto.created_at).toLocaleString('vi-VN')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPreviewPhoto(null);
                  setPreviewSignedUrl(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-center min-h-[300px] max-h-[70vh] bg-slate-950 rounded-lg overflow-hidden">
              {previewLoading ? (
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              ) : previewError ? (
                <div className="text-rose-400 text-xs p-4 text-center">
                  <AlertCircle className="w-6 h-6 mx-auto mb-1 text-rose-500" />
                  <p>{previewError}</p>
                </div>
              ) : previewSignedUrl ? (
                <img
                  src={previewSignedUrl}
                  alt={previewPhoto.file_name}
                  className="max-h-[68vh] max-w-full object-contain"
                />
              ) : null}
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="text-[11px] text-slate-500">
                Kích thước: {(previewPhoto.file_size / (1024 * 1024)).toFixed(2)} MB
              </div>
              <div className="flex items-center gap-2">
                {previewSignedUrl && (
                  <a
                    href={previewSignedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition"
                  >
                    <span>Mở tab mới</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setPreviewPhoto(null);
                    setPreviewSignedUrl(null);
                  }}
                  className="px-3.5 py-1.5 text-xs font-bold bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
