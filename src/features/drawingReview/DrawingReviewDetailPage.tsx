import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { permissions } from '../auth/authUtils';
import {
  fetchDrawingReviewDetail,
  saveDrawingReviewDraft,
  closeDrawingReviewVersion,
  createNextDrawingReviewVersion,
  validateSubconOperations,
  uploadDrawingReviewAttachment,
  deleteDrawingReviewAttachment,
  uploadItemAvatar,
  getDrawingFileSignedUrl,
  saveDrawingReviewAnnotations,
  formatHanoiDateTime,
  formatHanoiDate,
} from '../../services/drawingReviewService';
import { downloadDrawingReviewPdf } from '../../services/drawingReviewPdfService';
import { fetchWorkcenterMaster } from '../../services/jobCreationService';
import { UNIQUE_WORKCENTERS, type WorkcenterOption } from '../jobs/jobDisplayUtils';
import { PreliminaryRoutingMatrix } from './PreliminaryRoutingMatrix';
import { DrawingViewer, type DrawingViewerHandle } from './DrawingViewer';
import type { DrawingAnnotation } from './DrawingAnnotationLayer';
import { DrawingReviewStatusBadge } from '../../components/common/Badge';
import { ImageEditorModal } from '../../components/common/ImageEditorModal';
import { DrawingReviewHistoryModal } from './DrawingReviewHistoryModal';
import {
  ArrowLeft,
  Save,
  CheckCircle,
  AlertCircle,
  Loader2,
  FileText,
  Lock,
  Eye,
  Plus,
  X,
  AlertTriangle,
  Upload,
  Camera,
  Trash2,
  FileDown,
  Image as ImageIcon,
  Columns,
  ListTodo,
  Crop as CropIcon,
  History,
  Phone,
} from 'lucide-react';

export const DrawingReviewDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Issue & Versions data
  const [issue, setIssue] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Selected Version for viewing/editing
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  // History modal state
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Form State for Active Version
  const [materialType, setMaterialType] = useState('');
  const [materialSpecification, setMaterialSpecification] = useState('');
  const materialSpecTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [tooling, setTooling] = useState('');
  const [measuringEquipment, setMeasuringEquipment] = useState('');
  const [engineeringRemarks, setEngineeringRemarks] = useState('');
  const [operations, setOperations] = useState<
    Array<{
      id?: string;
      lineage_id: string;
      step_order: number;
      workcenter_code: string;
      operation_description?: string;
      cycle_time_seconds?: number | null;
      remark?: string;
      is_removed?: boolean;
      calculation_data?: any;
    }>
  >([]);

  // Avatar state
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarEditorFile, setAvatarEditorFile] = useState<File | null>(null);
  const [showAvatarEditor, setShowAvatarEditor] = useState(false);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const avatarCameraInputRef = useRef<HTMLInputElement>(null);
  const drawingViewerRef = useRef<DrawingViewerHandle>(null);

  // Photo Attachments state
  const [attachments, setAttachments] = useState<any[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [pendingAttachmentFile, setPendingAttachmentFile] = useState<File | null>(null);
  const [pendingCaption, setPendingCaption] = useState('');
  const [showCaptionModal, setShowCaptionModal] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<{ url: string; caption?: string; name: string } | null>(null);
  const photoFileInputRef = useRef<HTMLInputElement>(null);
  const photoCameraInputRef = useRef<HTMLInputElement>(null);

  // Drawing Annotations state & auto-persistence
  const [drawingAnnotations, setDrawingAnnotations] = useState<DrawingAnnotation[]>([]);

  // Split Workspace & Mobile layout state
  const [splitWidth, setSplitWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('drawing_review_split_width');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 25 && parsed <= 75) return parsed;
      }
    } catch {}
    return 45; // Default 45% left (Drawing) / 55% right (Review)
  });
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const [mobileTab, setMobileTab] = useState<'drawing' | 'review'>('review');
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const remarksTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Split synchronization with Cycle Time Calculator (allows drawing on left, calculator on right with resizable split)
  const [calculatorState, setCalculatorState] = useState<{
    isOpen: boolean;
    isFullScreen: boolean;
    drawerWidthPercent: number;
  }>({
    isOpen: false,
    isFullScreen: false,
    drawerWidthPercent: 50,
  });

  const handleCalculatorStateChange = useCallback(
    (isOpen: boolean, isFullScreen: boolean, drawerWidthPercent: number) => {
      setCalculatorState((prev) => {
        if (
          prev.isOpen === isOpen &&
          prev.isFullScreen === isFullScreen &&
          prev.drawerWidthPercent === drawerWidthPercent
        ) {
          return prev;
        }
        return { isOpen, isFullScreen, drawerWidthPercent };
      });
    },
    []
  );

  // Dirty tracking for unsaved changes warning
  const [isDirty, setIsDirty] = useState(false);

  // Action status
  const [isSaving, setIsSaving] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(
    (location.state as any)?.flashMessage || null
  );

  // Critical Save Error Modal & System Outage Warning State
  const [criticalSaveError, setCriticalSaveError] = useState<{
    show: boolean;
    title?: string;
    message?: string;
    technicalDetail?: string;
  } | null>(null);
  const [hasUnsavedSystemError, setHasUnsavedSystemError] = useState(false);

  // Confirmation Modal for Close
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeValidationErrors, setCloseValidationErrors] = useState<string[]>([]);

  // Work Centers list
  const [workcenters, setWorkcenters] = useState<WorkcenterOption[]>(UNIQUE_WORKCENTERS);

  // Load Work Center Master
  useEffect(() => {
    fetchWorkcenterMaster().then((wcs) => {
      if (wcs && wcs.length > 0) {
        setWorkcenters(wcs);
      }
    });
  }, []);

  // Load Issue and Versions detail
  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setFetchError(null);

    const res = await fetchDrawingReviewDetail(id);
    if (!res || res.error || !res.data) {
      setFetchError(res?.error || 'Không tìm thấy yêu cầu đánh giá bản vẽ.');
      setIssue(null);
    } else {
      const data = res.data;
      setIssue(data);

      // Select active or latest version
      const allVers = data.versions || [];
      const latestVer = data.latest_version || allVers[allVers.length - 1];
      const targetVer = allVers.find((v: any) => v.id === latestVer?.id) || latestVer;

      if (targetVer) {
        setSelectedVersionId(targetVer.id);
        const initialMatType = targetVer.material_type || '';
        const initialMatSpec = targetVer.material_specification || (!targetVer.material_type ? targetVer.required_material || '' : '');
        setMaterialType(initialMatType);
        setMaterialSpecification(initialMatSpec);
        setTooling(targetVer.required_tooling || '');
        setMeasuringEquipment(targetVer.special_measuring_equipment || '');
        setEngineeringRemarks(targetVer.engineering_remarks || '');
        setAttachments(targetVer.attachments || []);

        // Load avatar signed URL
        if (targetVer.avatar_file_path) {
          getDrawingFileSignedUrl(targetVer.avatar_file_path, 600).then((s) => {
            setAvatarUrl(s.signedUrl || null);
          });
        } else {
          setAvatarUrl(null);
        }

        const mappedOps = (targetVer.operations || []).map((op: any) => {
          let calcData = op.calculation_data;
          if (!calcData && op.lineage_id) {
            try {
              const cached = localStorage.getItem(
                `drawing_review_calc_${targetVer.id}_${op.lineage_id}`
              );
              if (cached) calcData = JSON.parse(cached);
            } catch {}
          }
          return {
            id: op.id,
            lineage_id: op.lineage_id || crypto.randomUUID(),
            step_order: op.step_order,
            workcenter_code: op.workcenter_code,
            operation_description: op.operation_description || '',
            cycle_time_seconds: op.cycle_time_seconds,
            remark: op.remark || op.remarks || '',
            is_removed: Boolean(op.is_removed),
            calculation_data: calcData || null,
          };
        });
        setOperations(mappedOps);
        setIsDirty(false);
      }
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // Determine current version object
  const currentVersion = useMemo(() => {
    if (!issue || !issue.versions) return null;
    return issue.versions.find((v: any) => v.id === selectedVersionId) || issue.latest_version;
  }, [issue, selectedVersionId]);

  // Sync annotations when currentVersion changes
  useEffect(() => {
    if (currentVersion?.annotations) {
      setDrawingAnnotations(currentVersion.annotations);
    }
  }, [currentVersion?.annotations]);

  const handleAnnotationsChange = useCallback(
    (newAnns: DrawingAnnotation[]) => {
      setDrawingAnnotations(newAnns);
      setIsDirty(true);
      if (currentVersion?.id) {
        saveDrawingReviewAnnotations(currentVersion.id, newAnns)
          .then((res) => {
            if (!res.success) {
              console.warn('Auto-save annotations error:', res.error);
              setHasUnsavedSystemError(true);
              setCriticalSaveError({
                show: true,
                title: 'CẢNH BÁO: KHÔNG LƯU ĐƯỢC GHI CHÚ BẢN VẼ!',
                message: 'Hệ thống gặp sự cố khi lưu nét vẽ/ghi chú. Hiện tại CHỈ XEM ĐƯỢC, KHÔNG LƯU ĐƯỢC. Vui lòng giữ nguyên tab và liên hệ Admin.',
                technicalDetail: res.error,
              });
            } else {
              setHasUnsavedSystemError(false);
            }
          })
          .catch((err) => {
            console.warn('Auto-save annotations error:', err);
            setHasUnsavedSystemError(true);
            setCriticalSaveError({
              show: true,
              title: 'CẢNH BÁO: KHÔNG LƯU ĐƯỢC GHI CHÚ BẢN VẼ!',
              message: 'Hệ thống gặp sự cố khi lưu nét vẽ/ghi chú. Hiện tại CHỈ XEM ĐƯỢC, KHÔNG LƯU ĐƯỢC. Vui lòng giữ nguyên tab và liên hệ Admin.',
              technicalDetail: err?.message || String(err),
            });
          });
      }
    },
    [currentVersion?.id]
  );

  const isCompleted = currentVersion?.status === 'Completed';
  const canEdit =
    permissions.canEditTechnicalReview(profile?.role) && !isCompleted;
  const isSpectator = !canEdit;

  // Auto-expanding Remarks Textarea
  useEffect(() => {
    if (remarksTextareaRef.current) {
      remarksTextareaRef.current.style.height = 'auto';
      remarksTextareaRef.current.style.height = `${Math.max(
        remarksTextareaRef.current.scrollHeight,
        96
      )}px`;
    }
  }, [engineeringRemarks]);

  // Auto-expanding Material Specification Textarea
  useEffect(() => {
    if (materialSpecTextareaRef.current) {
      materialSpecTextareaRef.current.style.height = 'auto';
      materialSpecTextareaRef.current.style.height = `${Math.max(
        materialSpecTextareaRef.current.scrollHeight,
        60
      )}px`;
    }
  }, [materialSpecification]);

  // Load signed URLs for photo attachments
  useEffect(() => {
    let active = true;
    const atts = currentVersion?.attachments || attachments || [];
    if (atts.length === 0) return;

    atts.forEach(async (att: any) => {
      if (att.file_path && !attachmentUrls[att.id]) {
        const res = await getDrawingFileSignedUrl(att.file_path, 600);
        if (active && res.signedUrl) {
          setAttachmentUrls((prev) => ({ ...prev, [att.id]: res.signedUrl! }));
        }
      }
    });

    return () => {
      active = false;
    };
  }, [currentVersion, attachments, attachmentUrls]);

  // Split divider drag interaction
  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingDivider(true);
  };

  useEffect(() => {
    if (!isDraggingDivider) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const newPercent = ((e.clientX - rect.left) / rect.width) * 100;
      // Clamp between 25% and 75%
      const clamped = Math.min(Math.max(parseFloat(newPercent.toFixed(1)), 25), 75);
      setSplitWidth(clamped);
    };

    const handleMouseUp = () => {
      setIsDraggingDivider(false);
      try {
        localStorage.setItem('drawing_review_split_width', String(splitWidth));
      } catch {}
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingDivider, splitWidth]);

  // Handle version selection switch
  const handleSelectVersion = (verId: string) => {
    if (isDirty && !window.confirm('Bạn có thay đổi chưa lưu. Bạn có chắc chắn muốn chuyển phiên bản?')) {
      return;
    }
    const targetVer = issue?.versions?.find((v: any) => v.id === verId);
    if (targetVer) {
      setSelectedVersionId(targetVer.id);
      const initialMatType = targetVer.material_type || '';
      const initialMatSpec = targetVer.material_specification || (!targetVer.material_type ? targetVer.required_material || '' : '');
      setMaterialType(initialMatType);
      setMaterialSpecification(initialMatSpec);
      setTooling(targetVer.required_tooling || '');
      setMeasuringEquipment(targetVer.special_measuring_equipment || '');
      setEngineeringRemarks(targetVer.engineering_remarks || '');
      setAttachments(targetVer.attachments || []);

      if (targetVer.avatar_file_path) {
        getDrawingFileSignedUrl(targetVer.avatar_file_path, 600).then((s) => {
          setAvatarUrl(s.signedUrl || null);
        });
      } else {
        setAvatarUrl(null);
      }

      const mappedOps = (targetVer.operations || []).map((op: any) => {
        let calcData = op.calculation_data;
        if (!calcData && op.lineage_id) {
          try {
            const cached = localStorage.getItem(
              `drawing_review_calc_${targetVer.id}_${op.lineage_id}`
            );
            if (cached) calcData = JSON.parse(cached);
          } catch {}
        }
        return {
          id: op.id,
          lineage_id: op.lineage_id || crypto.randomUUID(),
          step_order: op.step_order,
          workcenter_code: op.workcenter_code,
          operation_description: op.operation_description || '',
          cycle_time_seconds: op.cycle_time_seconds,
          remark: op.remark || '',
          is_removed: Boolean(op.is_removed),
          calculation_data: calcData || null,
        };
      });
      setOperations(mappedOps);
      setIsDirty(false);
      setActionError(null);
    }
  };

  // Operations update handler
  const handleOperationsChange = (newOps: typeof operations) => {
    setOperations(newOps);
    setIsDirty(true);
    if (currentVersion?.id) {
      newOps.forEach((op) => {
        if (op.calculation_data && op.lineage_id) {
          try {
            localStorage.setItem(
              `drawing_review_calc_${currentVersion.id}_${op.lineage_id}`,
              JSON.stringify(op.calculation_data)
            );
          } catch {}
        }
      });
    }
  };

  // SAVE Action
  const handleSaveDraft = async () => {
    if (!currentVersion?.id) return;
    setIsSaving(true);
    setActionError(null);
    setSuccessBanner(null);

    // Ensure all operations' calculation data are cached in localStorage
    operations.forEach((op) => {
      if (op.calculation_data && op.lineage_id) {
        try {
          localStorage.setItem(
            `drawing_review_calc_${currentVersion.id}_${op.lineage_id}`,
            JSON.stringify(op.calculation_data)
          );
        } catch {}
      }
    });

    const res = await saveDrawingReviewDraft({
      version_id: currentVersion.id,
      material_type: materialType,
      material_specification: materialSpecification,
      required_material: [materialType.trim(), materialSpecification.trim()].filter(Boolean).join('\n'),
      required_tooling: tooling,
      special_measuring_equipment: measuringEquipment,
      engineering_remarks: engineeringRemarks,
      annotations: drawingAnnotations.length > 0 ? drawingAnnotations : (currentVersion.annotations || []),
      operations: operations,
    });

    if (!res.success) {
      const errDetail = res.error || 'Lỗi kết nối hoặc hệ thống từ chối lưu dữ liệu.';
      setActionError(errDetail);
      setHasUnsavedSystemError(true);
      setCriticalSaveError({
        show: true,
        title: 'CẢNH BÁO: KHÔNG LƯU ĐƯỢC DỮ LIỆU ĐÁNH GIÁ BẢN VẼ!',
        message: 'Hệ thống đang gặp sự cố. Hiện tại CHỈ XEM ĐƯỢC, KHÔNG LƯU ĐƯỢC. Vui lòng KHÔNG đóng tab trình duyệt và liên hệ ngay với Quản trị viên (Admin) để được trợ giúp.',
        technicalDetail: errDetail,
      });
    } else {
      setIsDirty(false);
      setHasUnsavedSystemError(false);
      setCriticalSaveError(null);
      setSuccessBanner(
        `Lưu bản nháp kỹ thuật thành công! Trạng thái phiên bản: ${res.status || 'Reviewing'}.`
      );
      await loadDetail();
    }
    setIsSaving(false);
  };

  // Avatar crop/upload callback (from DrawingViewer or direct upload)
  const handleAvatarCropped = async (file: File, cropBox: any) => {
    if (!currentVersion?.id) return;
    setIsUploadingAvatar(true);
    setActionError(null);
    try {
      const res = await uploadItemAvatar(currentVersion.id, file);
      if (!res.avatarFilePath) {
        const errDetail = res.error || 'Lỗi khi tải ảnh đại diện lên lưu trữ.';
        setActionError(errDetail);
        setHasUnsavedSystemError(true);
        setCriticalSaveError({
          show: true,
          title: 'CẢNH BÁO: KHÔNG LƯU ĐƯỢC ẢNH ĐẠI DIỆN!',
          message: 'Hệ thống đang gặp sự cố. Hiện tại CHỈ XEM ĐƯỢC, KHÔNG LƯU ĐƯỢC.',
          technicalDetail: errDetail,
        });
        return;
      }
      // Save draft with new avatar
      const saveRes = await saveDrawingReviewDraft({
        version_id: currentVersion.id,
        material_type: materialType,
        material_specification: materialSpecification,
        required_material: [materialType.trim(), materialSpecification.trim()].filter(Boolean).join('\n'),
        required_tooling: tooling,
        special_measuring_equipment: measuringEquipment,
        engineering_remarks: engineeringRemarks,
        avatar_file_path: res.avatarFilePath,
        avatar_crop_box: cropBox,
        operations: operations,
      });

      if (saveRes.success) {
        const signed = await getDrawingFileSignedUrl(res.avatarFilePath, 600);
        setAvatarUrl(signed.signedUrl || null);
        setSuccessBanner('Đã cập nhật ảnh đại diện chi tiết (Item Avatar) thành công!');
        setIsDirty(false);
        setHasUnsavedSystemError(false);
        setCriticalSaveError(null);
      } else {
        const errDetail = saveRes.error || 'Lỗi khi lưu ảnh đại diện vào phiên bản.';
        setActionError(errDetail);
        setHasUnsavedSystemError(true);
        setCriticalSaveError({
          show: true,
          title: 'CẢNH BÁO: KHÔNG LƯU ĐƯỢC ẢNH ĐẠI DIỆN!',
          message: 'Hệ thống đang gặp sự cố. Hiện tại CHỈ XEM ĐƯỢC, KHÔNG LƯU ĐƯỢC.',
          technicalDetail: errDetail,
        });
      }
    } catch (err: any) {
      const errDetail = err.message || 'Lỗi xử lý ảnh đại diện.';
      setActionError(errDetail);
      setHasUnsavedSystemError(true);
      setCriticalSaveError({
        show: true,
        title: 'CẢNH BÁO: KHÔNG LƯU ĐƯỢC ẢNH ĐẠI DIỆN!',
        message: 'Hệ thống đang gặp sự cố. Hiện tại CHỈ XEM ĐƯỢC, KHÔNG LƯU ĐƯỢC.',
        technicalDetail: errDetail,
      });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // Direct Avatar Upload from Local Disk / Camera
  const handleDirectAvatarSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarEditorFile(file);
      setShowAvatarEditor(true);
    }
    e.target.value = '';
  };

  // Photo Attachment Upload
  const handleSelectPhotoAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPendingAttachmentFile(file);
      setPendingCaption('');
      setShowCaptionModal(true);
    }
    e.target.value = '';
  };

  const handleConfirmUploadAttachment = async () => {
    if (!currentVersion?.id || !pendingAttachmentFile) return;
    setIsUploadingPhoto(true);
    setActionError(null);

    const res = await uploadDrawingReviewAttachment(
      currentVersion.id,
      pendingAttachmentFile,
      pendingAttachmentFile.name,
      pendingCaption.trim() || undefined
    );

    if (res.error || !res.data) {
      setActionError(res.error || 'Tải ảnh đính kèm thất bại.');
    } else {
      setShowCaptionModal(false);
      setPendingAttachmentFile(null);
      setPendingCaption('');
      setSuccessBanner('Tải hình ảnh đính kèm thành công!');
      await loadDetail();
    }
    setIsUploadingPhoto(false);
  };

  const handleDeleteAttachment = async (attId: string, filePath: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa ảnh đính kèm này?')) return;
    setActionError(null);
    const res = await deleteDrawingReviewAttachment(attId, filePath);
    if (!res.success) {
      setActionError(res.error || 'Xóa ảnh đính kèm thất bại.');
    } else {
      setSuccessBanner('Đã xóa ảnh đính kèm thành công.');
      await loadDetail();
    }
  };

  // Handle attaching annotated drawing snapshot into Section 7 photo attachments
  const handleAttachAnnotatedDrawing = async (file: File, caption: string) => {
    if (!currentVersion?.id) return;
    setIsUploadingPhoto(true);
    setActionError(null);

    const res = await uploadDrawingReviewAttachment(
      currentVersion.id,
      file,
      file.name,
      caption
    );

    if (res.error || !res.data) {
      setActionError(res.error || 'Đính kèm bản vẽ có ghi chú thất bại.');
    } else {
      setSuccessBanner('Đã đính kèm ảnh bản vẽ kèm ghi chú vào mục 7 (Hình ảnh đính kèm) thành công!');
      await loadDetail();
    }
    setIsUploadingPhoto(false);
  };

  // Open Confirmation Modal for Close Version
  const handleOpenCloseModal = () => {
    const errors: string[] = [];

    // Validate SUBCON operations
    const subconRes = validateSubconOperations(operations);
    if (!subconRes.valid && subconRes.error) {
      errors.push(subconRes.error);
    }

    setCloseValidationErrors(errors);
    setShowCloseModal(true);
  };

  // Confirm Close Version
  const handleConfirmClose = async () => {
    if (!currentVersion?.id) return;
    setIsClosing(true);
    setActionError(null);

    // 1. Get live annotations from drawing viewer
    const liveAnnotations = drawingViewerRef.current?.getAnnotations() || drawingAnnotations;

    // 2. If there are annotations, auto-capture annotated drawing snapshot to attachments if not already attached!
    if (liveAnnotations && liveAnnotations.length > 0) {
      try {
        const hasExisting = attachments.some(
          (a) =>
            (a.caption || '').includes('Bản vẽ có ghi chú') ||
            (a.file_name || '').includes('Ban-ve-ghi-chu')
        );
        if (!hasExisting) {
          const blob = await drawingViewerRef.current?.getAnnotatedBlob();
          if (blob) {
            const file = new File(
              [blob],
              `Ban-ve-ghi-chu-${currentVersion.version_name}-${Date.now()}.png`,
              { type: 'image/png' }
            );
            await uploadDrawingReviewAttachment(
              currentVersion.id,
              file,
              file.name,
              `Bản vẽ có ghi chú kỹ thuật (${currentVersion.version_name})`
            );
          }
        }
      } catch (attErr) {
        console.warn('Could not auto-attach annotated drawing snapshot:', attErr);
      }
    }

    // 3. Save current values with annotations
    const draftRes = await saveDrawingReviewDraft({
      version_id: currentVersion.id,
      material_type: materialType,
      material_specification: materialSpecification,
      required_material: [materialType.trim(), materialSpecification.trim()].filter(Boolean).join('\n'),
      required_tooling: tooling,
      special_measuring_equipment: measuringEquipment,
      engineering_remarks: engineeringRemarks,
      avatar_file_path: currentVersion.avatar_file_path || undefined,
      avatar_crop_box: currentVersion.avatar_crop_box || undefined,
      annotations: liveAnnotations,
      operations: operations,
    });

    if (draftRes && draftRes.success === false) {
      const errDetail = draftRes.error || 'Lỗi kết nối hoặc hệ thống từ chối lưu dữ liệu.';
      setActionError(errDetail);
      setHasUnsavedSystemError(true);
      setCriticalSaveError({
        show: true,
        title: 'CẢNH BÁO: KHÔNG LƯU ĐƯỢC DỮ LIỆU ĐỂ CHỐT HOÀN THÀNH!',
        message: 'Hệ thống gặp sự cố khi lưu bản vẽ. Hiện tại CHỈ XEM ĐƯỢC, KHÔNG LƯU ĐƯỢC. Vui lòng giữ tab và liên hệ Admin.',
        technicalDetail: errDetail,
      });
      setIsClosing(false);
      setShowCloseModal(false);
      return;
    }

    // 4. Call close RPC
    const res = await closeDrawingReviewVersion(currentVersion.id);
    if (!res.success) {
      const errDetail = res.error || 'Chốt hoàn thành phiên bản thất bại.';
      setActionError(errDetail);
      setHasUnsavedSystemError(true);
      setCriticalSaveError({
        show: true,
        title: 'CẢNH BÁO: CHỐT HOÀN THÀNH PHIÊN BẢN THẤT BẠI!',
        message: 'Hệ thống gặp sự cố. Không thể chốt phiên bản lúc này. Dữ liệu chưa hoàn tất. Vui lòng giữ nguyên tab và liên hệ Admin.',
        technicalDetail: errDetail,
      });
      setIsClosing(false);
      setShowCloseModal(false);
    } else {
      setShowCloseModal(false);
      setIsClosing(false);
      setIsDirty(false);
      setHasUnsavedSystemError(false);
      setCriticalSaveError(null);
      navigate(`/drawing-reviews/${issue.id}/report`, {
        state: {
          flashMessage: `Phiên bản ${currentVersion.version_name} đã chốt hoàn thành thành công và được lưu trữ bất biến.`,
        },
      });
    }
  };

  // PDF Export
  const handleDownloadPdf = async () => {
    if (!issue || !currentVersion) return;
    setIsDownloadingPdf(true);
    setActionError(null);
    try {
      await downloadDrawingReviewPdf(
        issue,
        currentVersion,
        (currentVersion.operations || operations) as any,
        attachments
      );
    } catch (err: any) {
      setActionError(err.message || 'Lỗi khi tạo và tải tệp PDF.');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  // Create V+1 Action
  const handleCreateNextVersion = async () => {
    if (!issue?.id) return;
    if (
      !window.confirm(
        `Bạn có chắc chắn muốn tạo phiên bản tiếp theo (V${
          (issue.versions?.length || 1) + 1
        }) dựa trên dữ liệu của phiên bản hiện tại?`
      )
    ) {
      return;
    }

    const res = await createNextDrawingReviewVersion(issue.id);
    if (!res.success) {
      setActionError(res.error || 'Tạo phiên bản mới thất bại.');
    } else {
      setSuccessBanner(
        `Tạo phiên bản mới ${res.versionName || ''} thành công! Phiên bản đang ở trạng thái chỉnh sửa.`
      );
      await loadDetail();
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="text-xs font-semibold">Đang tải không gian đánh giá bản vẽ...</p>
      </div>
    );
  }

  if (fetchError || !issue) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4 text-center">
        <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900 mb-1">
          Không tìm thấy yêu cầu đánh giá bản vẽ
        </h2>
        <p className="text-xs text-slate-600 mb-4">{fetchError}</p>
        <Link
          to="/drawing-reviews"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 text-white text-xs font-semibold rounded-lg hover:bg-slate-700 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay lại danh sách</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-68px)] min-h-[580px] overflow-hidden bg-slate-100">
      {/* =========================================================================
          TOP COMPACT HEADER BAR: ISSUE META, VERSIONS & GLOBAL ACTIONS
          ========================================================================= */}
      <header className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-2 shadow-2xs z-30">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
          {/* Left: Back & Issue Identity */}
          <div className="flex items-center gap-2.5 min-w-0">
            <Link
              to="/drawing-reviews"
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition flex-shrink-0"
              title="Quay lại danh sách đánh giá bản vẽ"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 truncate">
                <span className="font-mono text-sm sm:text-base font-black text-slate-900 flex-shrink-0">
                  {issue.issue_no}
                </span>
                <span className="text-slate-300 font-bold">•</span>
                <span className="text-xs sm:text-sm font-bold text-blue-900 truncate">
                  {issue.item_no} — {issue.item_name}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                Khách hàng: <strong className="text-slate-700">{issue.customer}</strong> • Ngày tạo:{' '}
                {formatHanoiDate(issue.created_at)}
              </p>
            </div>
          </div>

          {/* Right: Version Switcher, Status & Navigation Controls */}
          <div className="flex items-center gap-2 flex-wrap justify-between md:justify-end flex-shrink-0">
            {/* Version Switcher Tabs */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs font-bold">
              {(issue.versions || []).map((ver: any) => {
                const isActive = ver.id === currentVersion?.id;
                return (
                  <button
                    key={ver.id}
                    type="button"
                    onClick={() => handleSelectVersion(ver.id)}
                    className={`px-2.5 py-1 rounded-md transition flex items-center gap-1.5 cursor-pointer ${
                      isActive
                        ? 'bg-white text-blue-700 shadow-2xs border border-slate-200 font-extrabold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    data-testid={`version-tab-${ver.version_name}`}
                  >
                    <span>{ver.version_name}</span>
                    {ver.status === 'Completed' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Current Version Status Badge */}
            {currentVersion && (
              <DrawingReviewStatusBadge status={currentVersion.status} />
            )}

            {/* Mobile Tab Switcher (Visible on small screens < md) */}
            <div className="flex md:hidden items-center bg-blue-50 border border-blue-200 p-0.5 rounded-lg text-xs font-bold">
              <button
                type="button"
                onClick={() => setMobileTab('drawing')}
                className={`px-2 py-1 rounded-md transition flex items-center gap-1 cursor-pointer ${
                  mobileTab === 'drawing'
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-blue-700 hover:bg-blue-100'
                }`}
                data-testid="mobile-tab-drawing-btn"
              >
                <Columns className="w-3.5 h-3.5" />
                <span>Bản vẽ</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileTab('review')}
                className={`px-2 py-1 rounded-md transition flex items-center gap-1 cursor-pointer ${
                  mobileTab === 'review'
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-blue-700 hover:bg-blue-100'
                }`}
                data-testid="mobile-tab-review-btn"
              >
                <ListTodo className="w-3.5 h-3.5" />
                <span>Đánh giá</span>
              </button>
            </div>

            {/* Export PDF Button */}
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isDownloadingPdf}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
              title="Tải báo cáo đánh giá bản vẽ dạng PDF"
              data-testid="detail-download-pdf-btn"
            >
              {isDownloadingPdf ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileDown className="w-3.5 h-3.5 text-blue-400" />
              )}
              <span className="hidden sm:inline">Xuất PDF</span>
            </button>

            {/* Activity History Button */}
            <button
              type="button"
              onClick={() => setShowHistoryModal(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold transition shadow-2xs cursor-pointer"
              title="Xem lịch sử thao tác & thay đổi trạng thái"
              data-testid="detail-view-history-btn"
            >
              <History className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden sm:inline">Lịch sử</span>
            </button>

            {/* If Completed, Link to Read-Only Report View */}
            {isCompleted && (
              <Link
                to={`/drawing-reviews/${issue.id}/report`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition"
              >
                <FileText className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Xem báo cáo</span>
              </Link>
            )}

            {/* Create V+1 Action Button */}
            {isCompleted &&
              currentVersion?.id === issue.latest_version?.id &&
              permissions.canCreateReviewVersion(profile?.role) && (
                <button
                  type="button"
                  onClick={handleCreateNextVersion}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition shadow-xs cursor-pointer"
                  data-testid="create-next-ver-btn"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tạo V{(issue.versions?.length || 1) + 1}</span>
                </button>
              )}
          </div>
        </div>
      </header>

      {/* Global Alerts & Notification Banners */}
      {/* Sticky High-Priority System Save Error Banner */}
      {hasUnsavedSystemError && (
        <div
          className="flex-shrink-0 bg-rose-600 text-white px-4 py-3 text-xs font-bold shadow-lg flex flex-col sm:flex-row sm:items-center justify-between border-b-2 border-rose-800 gap-2 z-30"
          data-testid="sticky-system-save-error-banner"
        >
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0 animate-pulse">
              <AlertTriangle className="w-4 h-4 text-amber-300" />
            </div>
            <div className="leading-tight">
              <p className="font-black tracking-wide text-amber-200 uppercase text-[11px] sm:text-xs">
                ⚠️ CẢNH BÁO: HỆ THỐNG GẶP SỰ CỐ — CHỈ XEM ĐƯỢC, KHÔNG LƯU ĐƯỢC!
              </p>
              <p className="text-[11px] text-white/90 font-normal">
                Dữ liệu bạn vừa chỉnh sửa chưa được lưu vào hệ thống. <strong className="underline">Tuyệt đối không tắt tab hoặc tải lại trang (F5)</strong>. Hãy liên hệ Quản trị viên (Admin) để được trợ giúp.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-center">
            <button
              type="button"
              onClick={() => {
                setCriticalSaveError({
                  show: true,
                  title: 'CẢNH BÁO: KHÔNG LƯU ĐƯỢC DỮ LIỆU ĐÁNH GIÁ BẢN VẼ!',
                  message: 'Hệ thống đang gặp sự cố. Hiện tại CHỈ XEM ĐƯỢC, KHÔNG LƯU ĐƯỢC. Vui lòng giữ tab và liên hệ Admin.',
                  technicalDetail: actionError || undefined,
                });
              }}
              className="px-2.5 py-1 text-xs bg-rose-800 hover:bg-rose-900 text-white rounded-lg transition cursor-pointer border border-white/20 underline shadow-2xs"
            >
              Xem số Admin & Chi tiết
            </button>
            <button
              type="button"
              onClick={() => handleSaveDraft()}
              disabled={isSaving}
              className="px-3.5 py-1 text-xs bg-white text-rose-700 hover:bg-rose-50 font-black rounded-lg transition cursor-pointer shadow-md flex items-center gap-1.5 active:scale-95"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Thử lưu lại</span>
            </button>
          </div>
        </div>
      )}

      {successBanner && (
        <div className="flex-shrink-0 bg-emerald-50 border-b border-emerald-200 px-4 py-2 text-emerald-900 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span className="font-semibold">{successBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessBanner(null)}
            className="text-emerald-500 hover:text-emerald-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {actionError && (
        <div className="flex-shrink-0 bg-rose-50 border-b border-rose-200 px-4 py-2 text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span className="font-semibold">{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-500 hover:text-rose-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* =========================================================================
          MAIN SPLIT WORKSPACE CONTAINER (DESKTOP & TABLET LANDSCAPE)
          ========================================================================= */}
      <div
        ref={splitContainerRef}
        className="flex-1 flex flex-col md:flex-row overflow-hidden relative select-auto"
      >
        {/* Invisible overlay while resizing to prevent mouse capture by iframes */}
        {isDraggingDivider && (
          <div className="fixed inset-0 z-50 cursor-col-resize select-none" />
        )}

        {/* -----------------------------------------------------------------------
            LEFT PANEL: TECHNICAL DRAWING VIEWER
            ----------------------------------------------------------------------- */}
        <section
          style={{
            width: calculatorState.isOpen
              ? calculatorState.isFullScreen
                ? '0%'
                : `${100 - calculatorState.drawerWidthPercent}%`
              : `${splitWidth}%`,
          }}
          className={`h-full flex-col bg-slate-900 border-r border-slate-800 flex-shrink-0 overflow-hidden ${
            mobileTab === 'drawing'
              ? 'flex !w-full'
              : calculatorState.isOpen && calculatorState.isFullScreen
              ? 'hidden'
              : 'hidden md:flex'
          }`}
          data-testid="desktop-drawing-panel"
        >
          {/* Internal width styling for desktop */}
          <div
            className="h-full flex flex-col overflow-hidden w-full"
          >
            {/* Section Heading Bar for Tests & Accessibility */}
            <div className="bg-slate-950 px-3.5 py-1.5 border-b border-slate-800 flex items-center justify-between text-xs font-bold text-slate-300 flex-shrink-0">
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-blue-900 text-blue-300 flex items-center justify-center text-[10px]">
                  2
                </span>
                <span>2. Bản vẽ kỹ thuật gốc (Drawing Viewer)</span>
              </span>
              <span className="text-[10px] text-slate-500 hidden sm:inline">
                Khung nhìn độc lập • Phóng to/Kéo thả
              </span>
            </div>

            {/* Drawing Viewer Component */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <DrawingViewer
                ref={drawingViewerRef}
                filePath={issue.drawing_file_path}
                fileName={issue.drawing_file_name}
                mimeType={issue.drawing_mime_type}
                canCropAvatar={canEdit}
                onAvatarCropped={handleAvatarCropped}
                versionId={currentVersion?.id}
                initialAnnotations={currentVersion?.annotations || []}
                onAnnotationsChange={handleAnnotationsChange}
                onAttachAnnotatedDrawing={canEdit ? handleAttachAnnotatedDrawing : undefined}
                fullHeight={true}
                className="h-full rounded-none border-0"
              />
            </div>
          </div>
        </section>

        {/* -----------------------------------------------------------------------
            RESIZABLE PANEL DIVIDER (Desktop & Tablet)
            ----------------------------------------------------------------------- */}
        <div
          onMouseDown={handleDividerMouseDown}
          className={`hidden md:flex w-2 bg-slate-200 hover:bg-blue-500 active:bg-blue-600 cursor-col-resize transition-colors items-center justify-center relative select-none z-30 group ${
            calculatorState.isOpen ? 'opacity-0 pointer-events-none' : ''
          }`}
          title="Kéo sang trái hoặc phải để thay đổi độ rộng giữa Bản vẽ và Biểu mẫu"
          data-testid="split-workspace-divider"
        >
          <div className="w-0.5 h-8 bg-slate-400 group-hover:bg-white rounded-full transition-colors" />
        </div>

        {/* -----------------------------------------------------------------------
            RIGHT PANEL: TECHNICAL REVIEW FORM & ACTIONS
            ----------------------------------------------------------------------- */}
        <section
          style={{
            width: calculatorState.isOpen
              ? calculatorState.isFullScreen
                ? '100%'
                : `${calculatorState.drawerWidthPercent}%`
              : `${100 - splitWidth}%`,
          }}
          className={`h-full flex-col flex-1 min-w-0 bg-slate-50 overflow-hidden ${
            mobileTab === 'review' ? 'flex !w-full' : 'hidden md:flex'
          }`}
          data-testid="desktop-review-panel"
        >
          {/* Scrollable Form Content */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5 scroll-smooth">
            {/* Spectator or Locked Notice */}
            {isCompleted ? (
              <div className="p-3 bg-slate-100 border border-slate-300 rounded-xl text-slate-700 text-xs flex items-center gap-2 font-medium">
                <Lock className="w-4 h-4 text-slate-500 flex-shrink-0" />
                <span>
                  Phiên bản <strong>{currentVersion?.version_name}</strong> đã hoàn thành vào{' '}
                  {currentVersion?.closed_at
                    ? formatHanoiDateTime(currentVersion.closed_at)
                    : 'N/A'}{' '}
                  và đã được khóa bất biến. Không thể chỉnh sửa trực tiếp.
                </span>
              </div>
            ) : isSpectator ? (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 text-xs flex items-center gap-2 font-medium">
                <Eye className="w-4 h-4 text-blue-600 flex-shrink-0" />
                <span>
                  Chế độ xem thông tin đánh giá (Spectator View): Bạn đang xem dữ liệu kỹ thuật được PE-MFG lưu trữ theo thời gian thực.
                </span>
              </div>
            ) : null}

            {/* SECTION 1: ISSUE INFORMATION & ITEM AVATAR */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3">
              <h2 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[11px] font-bold">
                  1
                </span>
                <span>Thông tin yêu cầu đánh giá bản vẽ (Issue Information)</span>
              </h2>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                {/* Metadata columns */}
                <div className="grid grid-cols-2 gap-3 text-xs flex-1">
                  <div>
                    <span className="text-slate-400 block text-[11px] font-medium">Mã yêu cầu</span>
                    <span className="font-mono font-bold text-slate-900 text-sm">
                      {issue.issue_no}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[11px] font-medium">Mã sản phẩm / Bản vẽ</span>
                    <span className="font-bold text-slate-900">{issue.item_no}</span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[11px] font-medium">Tên sản phẩm</span>
                    <span className="font-bold text-slate-900">{issue.item_name}</span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[11px] font-medium">Khách hàng</span>
                    <span className="font-bold text-slate-900">{issue.customer}</span>
                  </div>
                </div>

                {/* Item Avatar Card */}
                <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 p-2 rounded-xl flex-shrink-0">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="Item Avatar"
                      className="w-13 h-13 rounded-lg object-cover border border-slate-300 shadow-2xs"
                      data-testid="item-avatar-img"
                    />
                  ) : (
                    <div
                      className="w-13 h-13 rounded-lg bg-slate-200 border border-slate-300 flex flex-col items-center justify-center text-slate-400 text-[9px] font-bold"
                      data-testid="item-avatar-placeholder"
                    >
                      <ImageIcon className="w-4 h-4 mb-0.5 text-slate-400" />
                      <span>NO AVATAR</span>
                    </div>
                  )}

                  {canEdit && (
                    <div className="flex flex-col gap-1.5">
                      {/* Primary crop action: directly from drawing */}
                      <button
                        type="button"
                        onClick={() => {
                          if (mobileTab !== 'drawing') {
                            setMobileTab('drawing');
                          }
                          setTimeout(() => {
                            drawingViewerRef.current?.triggerCrop();
                          }, 50);
                        }}
                        disabled={isUploadingAvatar}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-[10px] font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
                        title="Cắt ảnh đại diện trực tiếp từ bản vẽ (Không cần tải ảnh hay chụp ảnh)"
                        data-testid="crop-drawing-avatar-card-btn"
                      >
                        <CropIcon className="w-3 h-3 flex-shrink-0" />
                        <span>Cắt từ bản vẽ</span>
                      </button>

                      {/* Optional alternatives: Upload / Camera */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => avatarFileInputRef.current?.click()}
                          disabled={isUploadingAvatar}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white hover:bg-slate-100 text-slate-700 rounded text-[9px] font-medium border border-slate-300 transition cursor-pointer"
                          title="Tải ảnh từ máy tính (tùy chọn)"
                          data-testid="upload-direct-avatar-btn"
                        >
                          <Upload className="w-2.5 h-2.5 text-blue-600" />
                          <span>Tải ảnh</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => avatarCameraInputRef.current?.click()}
                          disabled={isUploadingAvatar}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white hover:bg-slate-100 text-slate-700 rounded text-[9px] font-medium border border-slate-300 transition cursor-pointer"
                          title="Chụp ảnh bằng điện thoại (tùy chọn)"
                          data-testid="camera-direct-avatar-btn"
                        >
                          <Camera className="w-2.5 h-2.5 text-emerald-600" />
                          <span>Chụp ảnh</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Hidden Avatar inputs */}
              <input
                ref={avatarFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleDirectAvatarSelected}
                data-testid="direct-avatar-input"
              />
              <input
                ref={avatarCameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleDirectAvatarSelected}
                data-testid="camera-avatar-input"
              />

              {issue.attention && (
                <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-lg text-xs text-amber-950">
                  <span className="font-bold block mb-0.5">Lưu ý đặc biệt (Attention):</span>
                  <p className="whitespace-pre-line leading-relaxed font-sans">
                    {issue.attention}
                  </p>
                </div>
              )}
            </div>

            {/* SECTION 3: REQUIRED MATERIAL (MATERIAL TYPE & SPECIFICATION) */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3">
              <h2 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[11px] font-bold">
                  3
                </span>
                <span>Vật liệu yêu cầu (Required Material)</span>
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* 1. Material Type (Single-line free-text) */}
                <div className="md:col-span-1 space-y-1">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600">
                    Chủng loại vật liệu (Material Type)
                  </label>
                  {canEdit ? (
                    <input
                      type="text"
                      value={materialType}
                      onChange={(e) => {
                        setMaterialType(e.target.value);
                        setIsDirty(true);
                      }}
                      placeholder="VD: SUS304, SUS316L, S45C, S32205..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                      data-testid="material-type-input"
                    />
                  ) : (
                    <div
                      className="text-xs text-slate-800 bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-semibold"
                      data-testid="view-material-type"
                    >
                      {materialType.trim() || <span className="text-slate-400 italic font-normal">Chưa chỉ định</span>}
                    </div>
                  )}
                </div>

                {/* 2. Material Specification (Auto-expanding Multiline textarea) */}
                <div className="md:col-span-2 space-y-1">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600">
                    Quy cách / Thông số phôi (Material Specification)
                  </label>
                  {canEdit ? (
                    <textarea
                      ref={materialSpecTextareaRef}
                      rows={2}
                      value={materialSpecification}
                      onChange={(e) => {
                        setMaterialSpecification(e.target.value);
                        setIsDirty(true);
                        e.target.style.height = 'auto';
                        e.target.style.height = `${Math.max(e.target.scrollHeight, 60)}px`;
                      }}
                      placeholder="VD: Ø19.05 h9 × L3000&#10;Runout 0.08/400 max&#10;Hardness 22–30 HRC"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs leading-relaxed text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 resize-y min-h-[60px]"
                      data-testid="material-specification-textarea"
                    />
                  ) : (
                    <div
                      className="text-xs text-slate-800 bg-slate-50 p-2.5 rounded-lg border border-slate-200 whitespace-pre-line leading-relaxed font-sans"
                      data-testid="view-material-specification"
                    >
                      {materialSpecification.trim() || (
                        <span className="text-slate-400 italic">Không có yêu cầu đặc biệt.</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* SECTION 4: PRELIMINARY ROUTING MATRIX */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h2 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[11px] font-bold">
                    4
                  </span>
                  <span>Quy trình công nghệ sơ bộ (Preliminary Routing Matrix)</span>
                </h2>
                <span className="text-[11px] text-slate-400">
                  Đơn vị CT: <strong>sec/pc</strong> (Không cộng tổng)
                </span>
              </div>

              <PreliminaryRoutingMatrix
                allVersions={issue.versions || []}
                currentVersionId={currentVersion?.id || ''}
                isEditable={canEdit}
                operations={operations}
                workcenterOptions={workcenters}
                onChangeOperations={handleOperationsChange}
                onCalculatorStateChange={handleCalculatorStateChange}
              />
            </div>

            {/* SECTION 5: REQUIRED TOOLING */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-2.5">
              <h2 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[11px] font-bold">
                  5
                </span>
                <span>Dao cụ &amp; Đồ gá yêu cầu (Required Tooling)</span>
              </h2>

              {canEdit ? (
                <textarea
                  rows={2}
                  value={tooling}
                  onChange={(e) => {
                    setTooling(e.target.value);
                    setIsDirty(true);
                  }}
                  placeholder="Nhập thông tin dao cụ, mảnh tiện/phay đặc biệt, chấu kẹp chuyên dụng, đồ gá (Jig)..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs leading-relaxed text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  data-testid="tooling-textarea"
                />
              ) : (
                <div className="text-xs text-slate-800 bg-slate-50 p-2.5 rounded-lg border border-slate-200 whitespace-pre-line leading-relaxed font-sans">
                  {tooling.trim() || <span className="text-slate-400 italic">Chưa có thông tin dao cụ / đồ gá.</span>}
                </div>
              )}
            </div>

            {/* SECTION 6: SPECIAL MEASURING EQUIPMENT */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-2.5">
              <h2 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[11px] font-bold">
                  6
                </span>
                <span>Thiết bị đo lường đặc biệt (Special Measuring Equipment)</span>
              </h2>

              {canEdit ? (
                <textarea
                  rows={2}
                  value={measuringEquipment}
                  onChange={(e) => {
                    setMeasuringEquipment(e.target.value);
                    setIsDirty(true);
                  }}
                  placeholder="Nhập yêu cầu thiết bị đo (VD: Máy đo tọa độ CMM, Máy đo quang học 2D/3D, Dưỡng ren chuyên dụng, Máy đo độ nhám...)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs leading-relaxed text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  data-testid="measuring-textarea"
                />
              ) : (
                <div className="text-xs text-slate-800 bg-slate-50 p-2.5 rounded-lg border border-slate-200 whitespace-pre-line leading-relaxed font-sans">
                  {measuringEquipment.trim() || (
                    <span className="text-slate-400 italic">Chưa có thông tin thiết bị đo đặc biệt.</span>
                  )}
                </div>
              )}
            </div>

            {/* SECTION 7: ENGINEERING REMARKS & PHOTO ATTACHMENTS */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-4">
              <h2 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[11px] font-bold">
                  7
                </span>
                <span>Ghi chú kỹ thuật &amp; Hình ảnh đính kèm (Engineering Remarks &amp; Attachments)</span>
              </h2>

              {/* Remarks Textarea with Auto-Expansion */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-600 block">
                  Ghi chú tổng kết của PE-MFG:
                </label>
                {canEdit ? (
                  <textarea
                    ref={remarksTextareaRef}
                    rows={3}
                    value={engineeringRemarks}
                    onChange={(e) => {
                      setEngineeringRemarks(e.target.value);
                      setIsDirty(true);
                      e.target.style.height = 'auto';
                      e.target.style.height = `${Math.max(e.target.scrollHeight, 80)}px`;
                    }}
                    placeholder="Nhập ghi chú tổng kết của bộ phận Kỹ thuật / Sản xuất (PE-MFG) về tính khả thi, điểm chú ý gia công, đánh giá rủi ro..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs leading-relaxed text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 transition-all duration-75 resize-none"
                    data-testid="engineering-remarks-textarea"
                  />
                ) : (
                  <div className="text-xs text-slate-800 bg-slate-50 p-2.5 rounded-lg border border-slate-200 whitespace-pre-line leading-relaxed font-sans">
                    {engineeringRemarks.trim() || (
                      <span className="text-slate-400 italic">Không có ghi chú kỹ thuật.</span>
                    )}
                  </div>
                )}
              </div>

              {/* Photo Attachments Gallery */}
              <div className="space-y-3 pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700">
                      Hình ảnh đính kèm (Photo Attachments):
                    </span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      {attachments.length} ảnh
                    </span>
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => photoFileInputRef.current?.click()}
                        disabled={isUploadingPhoto}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold border border-blue-200 transition disabled:opacity-50 cursor-pointer"
                        data-testid="upload-photo-att-btn"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Tải ảnh</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => photoCameraInputRef.current?.click()}
                        disabled={isUploadingPhoto}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold border border-emerald-200 transition disabled:opacity-50 cursor-pointer"
                        data-testid="camera-photo-att-btn"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>Chụp ảnh</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Hidden photo inputs */}
                <input
                  ref={photoFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleSelectPhotoAttachment}
                  data-testid="photo-attachment-input"
                />
                <input
                  ref={photoCameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleSelectPhotoAttachment}
                  data-testid="camera-attachment-input"
                />

                {/* Photo Grid */}
                {attachments.length === 0 ? (
                  <div className="p-5 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50 text-slate-400 text-xs">
                    Chưa có hình ảnh đính kèm nào cho phiên bản này.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {attachments.map((att) => {
                      const url = attachmentUrls[att.id];
                      return (
                        <div
                          key={att.id}
                          className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs group hover:border-blue-400 transition flex flex-col"
                        >
                          <div
                            onClick={() =>
                              url &&
                              setPreviewPhoto({
                                url,
                                caption: att.caption,
                                name: att.file_name,
                              })
                            }
                            className="h-28 bg-slate-100 flex items-center justify-center overflow-hidden cursor-pointer relative"
                          >
                            {url ? (
                              <img
                                src={url}
                                alt={att.file_name}
                                className="w-full h-full object-cover group-hover:scale-105 transition duration-150"
                              />
                            ) : (
                              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                            )}
                          </div>
                          <div className="p-2 flex items-center justify-between gap-1 text-[11px] bg-white border-t border-slate-100">
                            <span className="truncate text-slate-700 font-medium" title={att.caption || att.file_name}>
                              {att.caption || att.file_name}
                            </span>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => handleDeleteAttachment(att.id, att.file_path)}
                                className="text-slate-400 hover:text-rose-600 p-1 rounded transition flex-shrink-0 cursor-pointer"
                                title="Xóa ảnh"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Extra padding at bottom so scroll never gets covered */}
            <div className="h-6" />
          </div>

          {/* =========================================================================
              DOCKED BOTTOM ACTION BAR (SAVE & CLOSE)
              ========================================================================= */}
          {canEdit && (
            <div
              className="flex-shrink-0 bg-white/95 backdrop-blur-md px-4 py-2.5 border-t border-slate-200 flex items-center justify-between z-20 shadow-md"
              data-testid="bottom-action-bar"
            >
              <div className="flex items-center gap-2 text-xs">
                {hasUnsavedSystemError ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-rose-100 text-rose-800 rounded-md border border-rose-300 font-bold text-[11px] animate-pulse">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                    <span>Lưu thất bại — Chỉ xem được!</span>
                  </span>
                ) : isDirty ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-amber-50 text-amber-800 rounded-md border border-amber-200 font-semibold text-[11px]">
                    <AlertCircle className="w-3 h-3 text-amber-600 animate-pulse" />
                    <span>Có thay đổi chưa lưu</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md border border-slate-200 text-[11px]">
                    <CheckCircle className="w-3 h-3 text-slate-400" />
                    <span>Đã đồng bộ</span>
                  </span>
                )}
                <span className="text-slate-400 hidden sm:inline">•</span>
                <span className="text-slate-500 hidden sm:inline text-[11px]">
                  Phiên bản: <strong>{currentVersion?.version_name}</strong>
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Save Draft Button */}
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={isSaving || isClosing}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 border font-bold text-xs rounded-lg transition disabled:opacity-50 cursor-pointer ${
                    hasUnsavedSystemError
                      ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700 shadow-md ring-2 ring-rose-400 animate-bounce'
                      : 'border-blue-600 hover:bg-blue-50 text-blue-700'
                  }`}
                  data-testid="save-draft-btn"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                      <span>Đang lưu...</span>
                    </>
                  ) : hasUnsavedSystemError ? (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
                      <span>Thử lưu lại</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Lưu bản nháp</span>
                    </>
                  )}
                </button>

                {/* Close Button */}
                <button
                  type="button"
                  onClick={handleOpenCloseModal}
                  disabled={isSaving || isClosing}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition shadow-xs disabled:opacity-50 cursor-pointer"
                  data-testid="close-version-btn"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Chốt hoàn thành</span>
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* =========================================================================
          MOBILE FLOATING TOGGLE PILL (Visible only on mobile screens < md)
          ========================================================================= */}
      <div className="md:hidden fixed bottom-4 right-4 z-40">
        <button
          type="button"
          onClick={() =>
            setMobileTab((prev) => (prev === 'drawing' ? 'review' : 'drawing'))
          }
          className="flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-full shadow-xl border border-white/20 active:scale-95 transition-all cursor-pointer"
          data-testid="mobile-floating-toggle-btn"
        >
          {mobileTab === 'review' ? (
            <>
              <Columns className="w-4 h-4" />
              <span>Xem Bản vẽ kỹ thuật</span>
            </>
          ) : (
            <>
              <ListTodo className="w-4 h-4" />
              <span>Về Biểu mẫu đánh giá</span>
            </>
          )}
        </button>
      </div>

      {/* Caption Modal for Photo Attachment Upload */}
      {showCaptionModal && pendingAttachmentFile && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="font-bold text-sm text-slate-900 mb-2">
              Thêm hình ảnh đính kèm ({pendingAttachmentFile.name})
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              Nhập ghi chú hoặc mô tả ngắn cho hình ảnh này (tùy chọn):
            </p>
            <input
              type="text"
              value={pendingCaption}
              onChange={(e) => setPendingCaption(e.target.value)}
              placeholder="VD: Chi tiết ren M8, Vết dao phay mặt, Ảnh mẫu..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-600"
              autoFocus
              data-testid="attachment-caption-input"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCaptionModal(false);
                  setPendingAttachmentFile(null);
                }}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConfirmUploadAttachment}
                disabled={isUploadingPhoto}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                data-testid="confirm-photo-upload-btn"
              >
                {isUploadingPhoto ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                <span>Tải lên</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Close */}
      {showCloseModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2 text-slate-900">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
                <h3 className="font-black text-sm">
                  Xác nhận chốt hoàn thành đánh giá kỹ thuật ({currentVersion?.version_name})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Validation Errors List if any */}
            {closeValidationErrors.length > 0 ? (
              <div className="space-y-3">
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs">
                  <div className="flex items-center gap-1.5 font-bold mb-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <span>Không thể hoàn thành do chưa đạt điều kiện bắt buộc:</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-[11px] leading-relaxed">
                    {closeValidationErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCloseModal(false)}
                    className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-700 cursor-pointer"
                  >
                    Đã hiểu, quay lại chỉnh sửa
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Khi chốt hoàn thành (Close), phiên bản{' '}
                  <strong className="text-slate-900">{currentVersion?.version_name}</strong> sẽ
                  được chuyển sang trạng thái <strong>Completed</strong> và trở nên{' '}
                  <strong className="text-rose-600">bất biến tuyệt đối (Immutable)</strong>. Mọi thay
                  đổi trong tương lai sẽ phải được thực hiện thông qua việc tạo phiên bản mới tiếp theo
                  (V{(issue.versions?.length || 1) + 1}).
                </p>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1 text-slate-700">
                  <div className="font-bold text-slate-900 mb-1">Tóm tắt dữ liệu sẽ chốt:</div>
                  <div>
                    • Số lượng công đoạn công nghệ: <strong>{operations.filter((o) => !o.is_removed).length} công đoạn</strong>
                  </div>
                  <div>
                    • Số tệp ảnh đính kèm: <strong>{attachments.length} tệp</strong>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowCloseModal(false)}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmClose}
                    disabled={isClosing}
                    className="inline-flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
                    data-testid="confirm-close-btn"
                  >
                    {isClosing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Đang chốt...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        <span>Xác nhận chốt hoàn thành</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Attachment Full Preview Modal */}
      {previewPhoto && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setPreviewPhoto(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full p-4 shadow-2xl border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-3">
              <span className="font-bold text-xs text-slate-800 truncate">
                {previewPhoto.caption || previewPhoto.name}
              </span>
              <button
                type="button"
                onClick={() => setPreviewPhoto(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[70vh] flex items-center justify-center bg-slate-900 rounded-lg overflow-hidden">
              <img
                src={previewPhoto.url}
                alt={previewPhoto.name}
                className="max-w-full max-h-[70vh] object-contain"
              />
            </div>
            {previewPhoto.caption && (
              <p className="text-xs text-slate-600 mt-2 italic text-center">
                {previewPhoto.caption}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Avatar Image Editor Modal */}
      {showAvatarEditor && avatarEditorFile && (
        <ImageEditorModal
          isOpen={showAvatarEditor}
          file={avatarEditorFile}
          category="drawing"
          onClose={() => {
            setShowAvatarEditor(false);
            setAvatarEditorFile(null);
          }}
          onConfirm={async (processedFile, stats) => {
            setShowAvatarEditor(false);
            setAvatarEditorFile(null);
            await handleAvatarCropped(processedFile, {
              width: stats.processedWidth,
              height: stats.processedHeight,
            });
          }}
        />
      )}
      {/* Drawing Review Activity History Modal */}
      {showHistoryModal && issue && (
        <DrawingReviewHistoryModal
          issueId={issue.id}
          issueNo={issue.issue_no}
          itemNo={issue.item_no}
          customer={issue.customer}
          onClose={() => setShowHistoryModal(false)}
        />
      )}

      {/* =========================================================================
          CRITICAL SYSTEM ERROR / SAVE FAILURE MODAL (PROMINENT & IMPOSSIBLE TO MISS)
          ========================================================================= */}
      {criticalSaveError?.show && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          data-testid="critical-save-error-modal"
        >
          <div className="bg-white border-2 border-rose-600 rounded-2xl shadow-2xl max-w-xl w-full p-6 text-slate-800 space-y-5 animate-in zoom-in-95 duration-200">
            {/* Header with pulsing alert badge */}
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-100 border border-rose-300 flex items-center justify-center text-rose-600 flex-shrink-0 animate-pulse">
                <AlertTriangle className="w-7 h-7" />
              </div>
              <div className="flex-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-600 text-white mb-1 shadow-xs">
                  <span>Sự cố hệ thống khẩn cấp</span>
                </div>
                <h3 className="text-lg font-black text-rose-700 leading-snug">
                  {criticalSaveError.title || 'CẢNH BÁO: KHÔNG LƯU ĐƯỢC DỮ LIỆU!'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCriticalSaveError((prev) => (prev ? { ...prev, show: false } : null))}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
                title="Đóng cửa sổ (Cảnh báo vẫn được duy trì ở thanh trên cùng)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Big prominent message */}
            <div className="bg-rose-50 border-2 border-rose-300 rounded-xl p-4 text-center space-y-2">
              <p className="text-base font-black text-rose-800 tracking-wide uppercase">
                HỆ THỐNG GẶP SỰ CỐ — CHỈ XEM ĐƯỢC, KHÔNG LƯU ĐƯỢC!
              </p>
              <p className="text-xs text-rose-700 font-medium">
                Dữ liệu bạn vừa chỉnh sửa (vật liệu, quy trình công nghệ, thời gian CT, ghi chú)
                <strong className="font-bold underline ml-1">chưa được lưu vào hệ thống</strong>.
              </p>
            </div>

            {/* Critical instruction box */}
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 space-y-1 text-xs text-amber-900">
              <div className="font-black flex items-center gap-1.5 text-amber-900 text-sm">
                <span>⛔ QUAN TRỌNG: TUYỆT ĐỐI KHÔNG TẮT TAB TRÌNH DUYỆT!</span>
              </div>
              <p className="leading-relaxed">
                Không tải lại trang (<kbd className="px-1 py-0.5 bg-white border border-amber-300 rounded font-mono font-bold">F5</kbd>) và không chuyển trang khác để tránh làm mất dữ liệu bạn vừa nhập. Dữ liệu vẫn được giữ trong bộ nhớ tab này.
              </p>
            </div>

            {/* Error detail */}
            {criticalSaveError.technicalDetail && (
              <div className="bg-slate-100 border border-slate-200 rounded-lg p-2.5 text-[11px] font-mono text-slate-700 overflow-x-auto max-h-24">
                <span className="font-bold text-slate-500 block mb-0.5">Chi tiết mã lỗi kỹ thuật:</span>
                <code>{criticalSaveError.technicalDetail}</code>
              </div>
            )}

            {/* Admin contact info */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 text-xs text-blue-950 space-y-2">
              <div className="font-bold text-blue-900 flex items-center gap-1.5 text-xs">
                <Phone className="w-4 h-4 text-blue-600" />
                <span>HÃY LIÊN LẠC VỚI ADMIN ĐỂ ĐƯỢC TRỢ GIÚP NGAY:</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="bg-white p-2 rounded-lg border border-blue-200 flex flex-col">
                  <span className="font-bold text-slate-800">Đỗ Xuân Trường (Admin)</span>
                  <a href="tel:0968041128" className="text-blue-600 font-bold hover:underline">
                    📞 0968 041 128
                  </a>
                </div>
                <div className="bg-white p-2 rounded-lg border border-blue-200 flex flex-col">
                  <span className="font-bold text-slate-800">Nguyễn Thu Hương (Admin)</span>
                  <a href="tel:0963238895" className="text-blue-600 font-bold hover:underline">
                    📞 0963 238 895
                  </a>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setCriticalSaveError((prev) => (prev ? { ...prev, show: false } : null))}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                Giữ nguyên tab để đợi Admin
              </button>
              <button
                type="button"
                onClick={() => {
                  setCriticalSaveError(null);
                  handleSaveDraft();
                }}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-xl transition cursor-pointer shadow-md"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Thử lưu lại ngay</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
