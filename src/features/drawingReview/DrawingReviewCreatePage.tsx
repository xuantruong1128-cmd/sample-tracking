import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { permissions } from '../auth/authUtils';
import {
  uploadDrawingFile,
  createDrawingReviewIssue,
  validateDrawingFile,
} from '../../services/drawingReviewService';
import {
  FileText,
  Upload,
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  FileCheck,
} from 'lucide-react';

export const DrawingReviewCreatePage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  // Form fields
  const [itemNo, setItemNo] = useState('');
  const [itemName, setItemName] = useState('');
  const [customer, setCustomer] = useState('');
  const [attention, setAttention] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Submission state
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Guard: BD and Admin only
  const canCreate = permissions.canCreateDrawingReview(profile?.role);
  if (!canCreate) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4 text-center">
        <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900 mb-1">
          Quyền truy cập bị từ chối
        </h2>
        <p className="text-xs text-slate-600 mb-4">
          Chỉ vai trò <strong>BD (Phát triển kinh doanh)</strong> hoặc <strong>Admin</strong> mới có quyền tạo yêu cầu đánh giá bản vẽ.
        </p>
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const validation = validateDrawingFile(file);
      if (!validation.valid) {
        setErrorMessage(validation.error || 'Tệp không hợp lệ.');
        setSelectedFile(null);
      } else {
        setSelectedFile(file);
        setErrorMessage(null);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Form validations
    if (!itemNo.trim()) {
      setErrorMessage('Vui lòng nhập Mã bản vẽ/sản phẩm (Item No.).');
      return;
    }
    if (!itemName.trim()) {
      setErrorMessage('Vui lòng nhập Tên sản phẩm (Item Name).');
      return;
    }
    if (!customer.trim()) {
      setErrorMessage('Vui lòng nhập Khách hàng (Customer).');
      return;
    }
    if (!selectedFile) {
      setErrorMessage('Vui lòng đính kèm tệp bản vẽ kỹ thuật (PDF, JPG, PNG).');
      return;
    }

    setLoading(true);

    try {
      // 1. Upload drawing file to private storage bucket 'drawing-reviews'
      const folderId = `issue_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const uploadRes = await uploadDrawingFile(selectedFile, folderId);

      if (uploadRes.error || !uploadRes.filePath) {
        setErrorMessage(uploadRes.error || 'Tải tệp bản vẽ thất bại.');
        setLoading(false);
        return;
      }

      // 2. Call backend atomic RPC to create Issue and initial V1 (status: Issued)
      const issueRes = await createDrawingReviewIssue({
        item_no: itemNo.trim(),
        item_name: itemName.trim(),
        customer: customer.trim(),
        drawing_file_path: uploadRes.filePath,
        drawing_file_name: uploadRes.fileName || selectedFile.name,
        drawing_file_size: uploadRes.fileSize || selectedFile.size,
        drawing_mime_type: uploadRes.mimeType || selectedFile.type,
        attention: attention.trim() || undefined,
      });

      if (!issueRes.success || !issueRes.issueId) {
        setErrorMessage(issueRes.error || 'Tạo yêu cầu đánh giá thất bại.');
        setLoading(false);
        return;
      }

      // Success: Navigate to the newly created issue
      navigate(`/drawing-reviews/${issueRes.issueId}`, {
        state: { flashMessage: `Tạo yêu cầu đánh giá ${issueRes.issueNo} (V1 - Issued) thành công!` },
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi hệ thống khi tạo yêu cầu đánh giá.');
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/drawing-reviews"
            className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 transition"
            title="Quay lại danh sách"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-blue-600" />
              <span>Phát hành yêu cầu đánh giá bản vẽ mới</span>
            </h1>
            <p className="text-xs text-slate-500">
              Giao diện tạo yêu cầu dành cho bộ phận Phát triển kinh doanh (BD)
            </p>
          </div>
        </div>
      </div>

      {/* Error Message Alert */}
      {errorMessage && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{errorMessage}</div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-500 hover:text-rose-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Form Card */}
      <form noValidate onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-5 sm:p-7 shadow-xs space-y-5">
        {/* Issue No Notice */}
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold">Mã Issue No:</span>
            <span className="font-mono bg-white px-2 py-0.5 rounded border border-blue-200 text-blue-700 font-bold">
              YYMMDD-N001 (Tự động cấp phát)
            </span>
          </div>
          <span className="text-[11px] text-blue-600">
            Khởi tạo phiên bản V1 (Trạng thái: Issued)
          </span>
        </div>

        {/* Item No & Item Name */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Mã bản vẽ / Sản phẩm (Item No.) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={itemNo}
              onChange={(e) => setItemNo(e.target.value)}
              placeholder="VD: D16-B001, BRACKET-01..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              data-testid="item-no-input"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Tên sản phẩm (Item Name) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="VD: Trục dẫn hướng, Mặt bích..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              data-testid="item-name-input"
            />
          </div>
        </div>

        {/* Customer */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
            Khách hàng (Customer) <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="VD: NIDEC, CANON, PANASONIC, TOYOTA..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            data-testid="customer-input"
          />
        </div>

        {/* Drawing File Upload */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
            Tệp bản vẽ kỹ thuật <span className="text-red-500">*</span>
          </label>
          <div className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-5 text-center transition bg-slate-50/60">
            {selectedFile ? (
              <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2.5 truncate">
                  <FileText className="w-5 h-5 text-blue-600 flex-shrink-0" />
                  <div className="text-left truncate">
                    <p className="text-xs font-bold text-slate-800 truncate">
                      {selectedFile.name}
                    </p>
                    <p className="text-[10px] text-slate-500 font-mono">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB • {selectedFile.type || 'Bản vẽ'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600"
                  title="Chọn tệp khác"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div>
                <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <label className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer transition shadow-xs">
                  <span>Chọn tệp bản vẽ</span>
                  <input
                    type="file"
                    required
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    onChange={handleFileChange}
                    className="hidden"
                    data-testid="drawing-file-input"
                  />
                </label>
                <p className="text-[11px] text-slate-400 mt-2">
                  Định dạng hỗ trợ: PDF, JPG, JPEG, PNG (Tối đa 50MB)
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Attention / Special Requirements */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
            Lưu ý / Yêu cầu đặc biệt của khách hàng (Attention)
          </label>
          <textarea
            rows={3}
            value={attention}
            onChange={(e) => setAttention(e.target.value)}
            placeholder="Nhập yêu cầu đặc biệt về dung sai, vật liệu chỉ định, nhiệt luyện, tiến độ hoặc tiêu chuẩn kiểm tra..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs leading-relaxed text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            data-testid="attention-textarea"
          />
        </div>

        {/* Submit Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
          <Link
            to="/drawing-reviews"
            className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg transition"
          >
            Hủy
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition shadow-xs"
            data-testid="submit-issue-btn"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Đang phát hành...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Phát hành yêu cầu (Submit Issue)</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
