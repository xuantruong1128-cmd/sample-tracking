import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { permissions } from '../auth/authUtils';
import {
  fetchDrawingReviewList,
  createNextDrawingReviewVersion,
  formatHanoiDate,
} from '../../services/drawingReviewService';
import { DrawingReviewStatusBadge } from '../../components/common/Badge';
import { DrawingAvatarThumbnail } from './DrawingAvatarThumbnail';
import { DrawingViewer } from './DrawingViewer';
import type {
  DrawingReviewIssue,
  DrawingReviewVersion,
  DrawingReviewOperation,
} from '../../types/database.types';
import {
  FileText,
  Plus,
  RefreshCw,
  Loader2,
  AlertCircle,
  Eye,
  X,
  Maximize2,
  RotateCcw,
  Calendar,
  Filter,
  ChevronDown,
  Check,
  Package,
  Hash,
  Building2,
  Layers,
  Tag,
  History,
} from 'lucide-react';
import { useTableColumnResizer } from '../../hooks/useTableColumnResizer';
import { DrawingReviewHistoryModal } from './DrawingReviewHistoryModal';

export const DEFAULT_DRAWING_COL_WIDTHS: Record<string, number> = {
  picture: 90,
  issue_no: 130,
  product: 220,
  customer: 110,
  routing: 320,
  issue_date: 110,
  version: 80,
  status: 120,
  actions: 95,
};

export const MIN_DRAWING_COL_WIDTHS: Record<string, number> = {
  picture: 65,
  issue_no: 95,
  product: 120,
  customer: 70,
  routing: 160,
  issue_date: 85,
  version: 60,
  status: 90,
  actions: 75,
};

type MatchMode = 'contain' | 'equal';
type DateFilterMode = 'all' | 'range' | 'equal' | 'less_than' | 'greater_than';
type FilterFieldKey = 'product' | 'issue_no' | 'customer' | 'process' | 'date' | 'status';

const FILTER_FIELD_OPTIONS: Array<{
  key: FilterFieldKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'product', label: 'Sản phẩm (Product)', icon: Package },
  { key: 'issue_no', label: 'Mã Issue No', icon: Hash },
  { key: 'customer', label: 'Khách hàng (Customer)', icon: Building2 },
  { key: 'process', label: 'Công đoạn (Routing)', icon: Layers },
  { key: 'date', label: 'Ngày phát hành (Date)', icon: Calendar },
  { key: 'status', label: 'Trạng thái (Status)', icon: Tag },
];

export const DrawingReviewListPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [issues, setIssues] = useState<
    Array<
      DrawingReviewIssue & {
        versions: Array<
          DrawingReviewVersion & {
            operations?: DrawingReviewOperation[];
          }
        >;
        latest_version?: DrawingReviewVersion & {
          operations?: DrawingReviewOperation[];
        };
      }
    >
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Full Drawing Zoom/Pan Viewer Modal state
  const [previewDrawingIssue, setPreviewDrawingIssue] = useState<
    (DrawingReviewIssue & {
      versions: Array<
        DrawingReviewVersion & {
          operations?: DrawingReviewOperation[];
        }
      >;
      latest_version?: DrawingReviewVersion & {
        operations?: DrawingReviewOperation[];
      };
    }) | null
  >(null);

  // History / Activity Log Modal state
  const [historyIssue, setHistoryIssue] = useState<any | null>(null);

  // Detailed Filter States
  // 1. Issue No (Equal, Contain)
  const [issueNoMode, setIssueNoMode] = useState<MatchMode>('contain');
  const [issueNoFilter, setIssueNoFilter] = useState('');

  // 2. Product (Equal, Contain)
  const [productMode, setProductMode] = useState<MatchMode>('contain');
  const [productFilter, setProductFilter] = useState('');

  // 3. Customer
  const [customerFilter, setCustomerFilter] = useState('ALL');

  // 4. Process from Routing (Equal, Contain)
  const [processMode, setProcessMode] = useState<MatchMode>('contain');
  const [processFilter, setProcessFilter] = useState('');

  // 5. Date (Range, Equal, Less than, Greater than)
  const [dateMode, setDateMode] = useState<DateFilterMode>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateExact, setDateExact] = useState('');
  const [dateBefore, setDateBefore] = useState('');
  const [dateAfter, setDateAfter] = useState('');

  // 6. Status
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Excel-like Column Width Resizer State
  const {
    columnWidths: drawingColWidths,
    handleResizeStart,
    handleResetColumnWidth,
  } = useTableColumnResizer({
    storageKey: 'sample_tracking_drawing_review_col_widths',
    defaultWidths: DEFAULT_DRAWING_COL_WIDTHS,
    minWidths: MIN_DRAWING_COL_WIDTHS,
  });

  const totalTableWidth = useMemo(() => {
    return Object.values(drawingColWidths).reduce((a, b) => a + b, 0);
  }, [drawingColWidths]);

  // Dynamic Active Filter Fields on 1-Row Toolbar
  const [activeFields, setActiveFields] = useState<FilterFieldKey[]>(['product']);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setIsFilterMenuOpen(false);
      }
    };
    if (isFilterMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isFilterMenuOpen]);

  const toggleField = (key: FilterFieldKey) => {
    setActiveFields((prev) => {
      if (prev.includes(key)) {
        if (key === 'issue_no') {
          setIssueNoFilter('');
          setIssueNoMode('contain');
        } else if (key === 'product') {
          setProductFilter('');
          setProductMode('contain');
        } else if (key === 'customer') {
          setCustomerFilter('ALL');
        } else if (key === 'process') {
          setProcessFilter('');
          setProcessMode('contain');
        } else if (key === 'date') {
          setDateMode('all');
          setDateFrom('');
          setDateTo('');
          setDateExact('');
          setDateBefore('');
          setDateAfter('');
        } else if (key === 'status') {
          setStatusFilter('ALL');
        }
        return prev.filter((k) => k !== key);
      } else {
        return [...prev, key];
      }
    });
  };

  const canCreate = permissions.canCreateDrawingReview(profile?.role);
  const canCreateVersion = permissions.canCreateReviewVersion(profile?.role);

  const loadIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchDrawingReviewList();
    if (res.error) {
      setError(res.error);
      setIssues([]);
    } else {
      setIssues(res.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadIssues();
  }, [loadIssues]);

  // Unique customer list for filter dropdown
  const uniqueCustomers = useMemo(() => {
    const set = new Set<string>();
    for (const item of issues) {
      if (item.customer) set.add(item.customer);
    }
    return Array.from(set).sort();
  }, [issues]);

  // Check if any filter is active
  const isAnyFilterActive = useMemo(() => {
    return (
      Boolean(issueNoFilter.trim()) ||
      Boolean(productFilter.trim()) ||
      customerFilter !== 'ALL' ||
      Boolean(processFilter.trim()) ||
      dateMode !== 'all' ||
      statusFilter !== 'ALL'
    );
  }, [
    issueNoFilter,
    productFilter,
    customerFilter,
    processFilter,
    dateMode,
    statusFilter,
  ]);

  // Reset all filters to default
  const handleResetFilters = () => {
    setIssueNoFilter('');
    setIssueNoMode('contain');
    setProductFilter('');
    setProductMode('contain');
    setCustomerFilter('ALL');
    setProcessFilter('');
    setProcessMode('contain');
    setDateMode('all');
    setDateFrom('');
    setDateTo('');
    setDateExact('');
    setDateBefore('');
    setDateAfter('');
    setStatusFilter('ALL');
  };

  // Filtered issues with exact user requirements
  const filteredIssues = useMemo(() => {
    return issues.filter((item) => {
      // 1. Issue No (Equal / Contain)
      if (issueNoFilter.trim()) {
        const query = issueNoFilter.trim().toLowerCase();
        const target = item.issue_no.trim().toLowerCase();
        if (issueNoMode === 'equal') {
          if (target !== query) return false;
        } else {
          if (!target.includes(query)) return false;
        }
      }

      // 2. Product (Equal / Contain) - checks item_no and item_name
      if (productFilter.trim()) {
        const query = productFilter.trim().toLowerCase();
        const itemNo = item.item_no.trim().toLowerCase();
        const itemName = (item.item_name || '').trim().toLowerCase();
        if (productMode === 'equal') {
          if (itemNo !== query && itemName !== query) return false;
        } else {
          if (!itemNo.includes(query) && !itemName.includes(query)) return false;
        }
      }

      // 3. Customer
      if (customerFilter !== 'ALL') {
        if (item.customer !== customerFilter) return false;
      }

      // 4. Process from Routing (Equal / Contain)
      if (processFilter.trim()) {
        const query = processFilter.trim().toLowerCase();
        const ops = item.latest_version?.operations || [];
        const hasMatch = ops.some((op) => {
          if (op.is_removed) return false;
          const code = (op.workcenter_code || '').trim().toLowerCase();
          const desc = (op.operation_description || '').trim().toLowerCase();
          if (processMode === 'equal') {
            return code === query;
          } else {
            return code.includes(query) || desc.includes(query);
          }
        });
        if (!hasMatch) return false;
      }

      // 5. Date (Range, Equal, Less than, Greater than) on issue.created_at
      if (dateMode !== 'all') {
        const itemDate = new Date(item.created_at);
        const yyyy = itemDate.getFullYear();
        const mm = String(itemDate.getMonth() + 1).padStart(2, '0');
        const dd = String(itemDate.getDate()).padStart(2, '0');
        const itemDateStr = `${yyyy}-${mm}-${dd}`;

        if (dateMode === 'range') {
          if (dateFrom && itemDateStr < dateFrom) return false;
          if (dateTo && itemDateStr > dateTo) return false;
        } else if (dateMode === 'equal') {
          if (dateExact && itemDateStr !== dateExact) return false;
        } else if (dateMode === 'less_than') {
          if (dateBefore && itemDateStr > dateBefore) return false;
        } else if (dateMode === 'greater_than') {
          if (dateAfter && itemDateStr < dateAfter) return false;
        }
      }

      // 6. Status
      if (statusFilter !== 'ALL') {
        const latestStatus = item.latest_version?.status || 'Issued';
        if (latestStatus !== statusFilter) return false;
      }

      return true;
    });
  }, [
    issues,
    issueNoMode,
    issueNoFilter,
    productMode,
    productFilter,
    customerFilter,
    processMode,
    processFilter,
    dateMode,
    dateFrom,
    dateTo,
    dateExact,
    dateBefore,
    dateAfter,
    statusFilter,
  ]);

  // Handle Quick Create V+1 from Dashboard
  const handleCreateNextVersion = async (
    e: React.MouseEvent,
    issueId: string,
    currentVerCount: number
  ) => {
    e.stopPropagation();
    if (!canCreateVersion) return;
    if (
      !window.confirm(
        `Xác nhận tạo phiên bản mới tiếp theo (V${currentVerCount + 1}) cho yêu cầu này?`
      )
    ) {
      return;
    }

    setLoading(true);
    const res = await createNextDrawingReviewVersion(issueId);
    if (!res.success) {
      alert(res.error || 'Tạo phiên bản mới thất bại.');
      setLoading(false);
    } else {
      navigate(`/drawing-reviews/${issueId}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs">
              <FileText className="w-5 h-5" />
            </div>
            <span>Đánh giá bản vẽ kỹ thuật (Drawing Review)</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Quy trình tiếp nhận bản vẽ từ BD, đánh giá tính khả thi và lập sơ bộ công nghệ bởi PE-MFG
          </p>
        </div>

        {canCreate && (
          <Link
            to="/drawing-reviews/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition"
            data-testid="create-new-review-btn"
          >
            <Plus className="w-4 h-4" />
            <span>Phát hành bản vẽ mới</span>
          </Link>
        )}
      </div>

      {/* 1-Row Compact Search & Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-xs">
        <div className="flex items-center justify-between gap-2.5 flex-wrap">
          {/* Left: Filter Field Selector & Active Filter Inputs on 1 Single Row */}
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {/* Field Picker Dropdown */}
            <div className="relative flex-shrink-0" ref={filterMenuRef}>
              <button
                type="button"
                onClick={() => setIsFilterMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 active:bg-blue-200 border border-blue-200 transition shadow-2xs whitespace-nowrap cursor-pointer"
                data-testid="add-filter-button"
                title="Chọn các trường muốn tìm kiếm"
              >
                <Filter className="w-3.5 h-3.5 text-blue-600" />
                <span>+ Thêm trường lọc</span>
                <ChevronDown
                  className={`w-3 h-3 text-blue-600 transition-transform duration-150 ${
                    isFilterMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isFilterMenuOpen && (
                <div
                  className="absolute left-0 mt-1.5 w-60 bg-white border border-slate-200 rounded-xl shadow-xl z-30 py-1.5 text-xs animate-in fade-in zoom-in-95 duration-100"
                  data-testid="filter-fields-menu"
                >
                  <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 mb-1">
                    Chọn trường tìm kiếm
                  </div>
                  {FILTER_FIELD_OPTIONS.map((field) => {
                    const isSelected = activeFields.includes(field.key);
                    return (
                      <button
                        key={field.key}
                        type="button"
                        onClick={() => toggleField(field.key)}
                        className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition cursor-pointer ${
                          isSelected
                            ? 'bg-blue-50/70 text-blue-700 font-semibold'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                        data-testid={`toggle-filter-${field.key}`}
                      >
                        <span className="flex items-center gap-2">
                          <field.icon className={`w-3.5 h-3.5 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`} />
                          <span>{field.label}</span>
                        </span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 font-bold" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Active Field: Product */}
            {activeFields.includes('product') && (
              <div className="inline-flex items-center gap-1 px-2 py-1 bg-slate-50 border border-slate-300 rounded-lg text-xs shadow-2xs flex-shrink-0">
                <span className="font-bold text-slate-700 whitespace-nowrap text-[11px]">SP:</span>
                <select
                  value={productMode}
                  onChange={(e) => setProductMode(e.target.value as MatchMode)}
                  className="text-[10px] font-medium text-slate-600 bg-white border border-slate-200 rounded px-1 py-0.5 cursor-pointer"
                  data-testid="product-mode-select"
                >
                  <option value="contain">Chứa</option>
                  <option value="equal">Bằng</option>
                </select>
                <input
                  type="text"
                  value={productFilter}
                  onChange={(e) => setProductFilter(e.target.value)}
                  placeholder="Mã/tên SP..."
                  className="w-28 sm:w-36 px-2 py-0.5 text-xs bg-white border border-slate-200 rounded text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  data-testid="search-input"
                />
                <button
                  type="button"
                  onClick={() => toggleField('product')}
                  className="text-slate-400 hover:text-rose-600 p-0.5 rounded cursor-pointer"
                  title="Ẩn trường Sản phẩm"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Active Field: Issue No */}
            {activeFields.includes('issue_no') && (
              <div className="inline-flex items-center gap-1 px-2 py-1 bg-slate-50 border border-slate-300 rounded-lg text-xs shadow-2xs flex-shrink-0">
                <span className="font-bold text-slate-700 whitespace-nowrap text-[11px]">Issue:</span>
                <select
                  value={issueNoMode}
                  onChange={(e) => setIssueNoMode(e.target.value as MatchMode)}
                  className="text-[10px] font-medium text-slate-600 bg-white border border-slate-200 rounded px-1 py-0.5 cursor-pointer"
                  data-testid="issue-no-mode-select"
                >
                  <option value="contain">Chứa</option>
                  <option value="equal">Bằng</option>
                </select>
                <input
                  type="text"
                  value={issueNoFilter}
                  onChange={(e) => setIssueNoFilter(e.target.value)}
                  placeholder="Nhập Issue No..."
                  className="w-24 sm:w-32 px-2 py-0.5 text-xs font-mono bg-white border border-slate-200 rounded text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  data-testid="filter-issue-no-input"
                />
                <button
                  type="button"
                  onClick={() => toggleField('issue_no')}
                  className="text-slate-400 hover:text-rose-600 p-0.5 rounded cursor-pointer"
                  title="Ẩn trường Issue No"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Active Field: Customer */}
            {activeFields.includes('customer') && (
              <div className="inline-flex items-center gap-1 px-2 py-1 bg-slate-50 border border-slate-300 rounded-lg text-xs shadow-2xs flex-shrink-0">
                <span className="font-bold text-slate-700 whitespace-nowrap text-[11px]">Khách:</span>
                <select
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value)}
                  className="text-xs bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600 max-w-[130px] truncate cursor-pointer"
                  data-testid="customer-filter"
                >
                  <option value="ALL">Tất cả khách hàng</option>
                  {uniqueCustomers.map((cust) => (
                    <option key={cust} value={cust}>{cust}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => toggleField('customer')}
                  className="text-slate-400 hover:text-rose-600 p-0.5 rounded cursor-pointer"
                  title="Ẩn trường Khách hàng"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Active Field: Process */}
            {activeFields.includes('process') && (
              <div className="inline-flex items-center gap-1 px-2 py-1 bg-slate-50 border border-slate-300 rounded-lg text-xs shadow-2xs flex-shrink-0">
                <span className="font-bold text-slate-700 whitespace-nowrap text-[11px]">Routing:</span>
                <select
                  value={processMode}
                  onChange={(e) => setProcessMode(e.target.value as MatchMode)}
                  className="text-[10px] font-medium text-slate-600 bg-white border border-slate-200 rounded px-1 py-0.5 cursor-pointer"
                  data-testid="process-mode-select"
                >
                  <option value="contain">Chứa</option>
                  <option value="equal">Bằng</option>
                </select>
                <input
                  type="text"
                  value={processFilter}
                  onChange={(e) => setProcessFilter(e.target.value)}
                  placeholder="Vd: A20C..."
                  className="w-20 sm:w-28 px-2 py-0.5 text-xs font-mono bg-white border border-slate-200 rounded text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  data-testid="filter-process-input"
                />
                <button
                  type="button"
                  onClick={() => toggleField('process')}
                  className="text-slate-400 hover:text-rose-600 p-0.5 rounded cursor-pointer"
                  title="Ẩn trường Routing"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Active Field: Status */}
            {activeFields.includes('status') && (
              <div className="inline-flex items-center gap-1 px-2 py-1 bg-slate-50 border border-slate-300 rounded-lg text-xs shadow-2xs flex-shrink-0">
                <span className="font-bold text-slate-700 whitespace-nowrap text-[11px]">Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="text-xs font-semibold bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600 cursor-pointer"
                  data-testid="status-filter"
                >
                  <option value="ALL">Tất cả trạng thái</option>
                  <option value="Issued">Issued</option>
                  <option value="Reviewing">Reviewing</option>
                  <option value="Completed">Completed</option>
                  <option value="Quoted">Quoted</option>
                  <option value="Requote">Requote</option>
                  <option value="Requoted">Requoted</option>
                </select>
                <button
                  type="button"
                  onClick={() => toggleField('status')}
                  className="text-slate-400 hover:text-rose-600 p-0.5 rounded cursor-pointer"
                  title="Ẩn trường Status"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Active Field: Issue Date */}
            {activeFields.includes('date') && (
              <div className="inline-flex items-center gap-1 px-2 py-1 bg-slate-50 border border-slate-300 rounded-lg text-xs shadow-2xs flex-shrink-0">
                <span className="font-bold text-slate-700 whitespace-nowrap text-[11px]">Ngày:</span>
                <select
                  value={dateMode}
                  onChange={(e) => setDateMode(e.target.value as DateFilterMode)}
                  className="text-[11px] font-medium bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-600 cursor-pointer"
                  data-testid="date-mode-select"
                >
                  <option value="all">Tất cả ngày</option>
                  <option value="range">Khoảng ngày</option>
                  <option value="equal">Đúng ngày</option>
                  <option value="less_than">Trước ngày</option>
                  <option value="greater_than">Sau ngày</option>
                </select>

                {dateMode === 'range' && (
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="px-1.5 py-0.5 text-[11px] font-mono border border-slate-200 rounded bg-white"
                      data-testid="filter-date-from"
                    />
                    <span className="text-[10px] text-slate-400">~</span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="px-1.5 py-0.5 text-[11px] font-mono border border-slate-200 rounded bg-white"
                      data-testid="filter-date-to"
                    />
                  </div>
                )}
                {dateMode === 'equal' && (
                  <input
                    type="date"
                    value={dateExact}
                    onChange={(e) => setDateExact(e.target.value)}
                    className="px-1.5 py-0.5 text-[11px] font-mono border border-slate-200 rounded bg-white"
                    data-testid="filter-date-exact"
                  />
                )}
                {dateMode === 'less_than' && (
                  <input
                    type="date"
                    value={dateBefore}
                    onChange={(e) => setDateBefore(e.target.value)}
                    className="px-1.5 py-0.5 text-[11px] font-mono border border-slate-200 rounded bg-white"
                    data-testid="filter-date-before"
                  />
                )}
                {dateMode === 'greater_than' && (
                  <input
                    type="date"
                    value={dateAfter}
                    onChange={(e) => setDateAfter(e.target.value)}
                    className="px-1.5 py-0.5 text-[11px] font-mono border border-slate-200 rounded bg-white"
                    data-testid="filter-date-after"
                  />
                )}
                <button
                  type="button"
                  onClick={() => toggleField('date')}
                  className="text-slate-400 hover:text-rose-600 p-0.5 rounded cursor-pointer"
                  title="Ẩn trường Ngày"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Empty state when no field is chosen */}
            {activeFields.length === 0 && (
              <span className="text-xs text-slate-400 italic">
                Chưa chọn trường tìm kiếm. Bấm "+ Thêm trường lọc" để bắt đầu lọc.
              </span>
            )}
          </div>

          {/* Right: Actions & Counter */}
          <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
            {isAnyFilterActive && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 rounded-lg transition cursor-pointer shadow-2xs"
                data-testid="reset-filters-btn"
                title="Xóa tất cả điều kiện lọc"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Xóa lọc</span>
              </button>
            )}

            <button
              type="button"
              onClick={loadIssues}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-blue-600 hover:bg-slate-100 border border-slate-200 rounded-lg transition cursor-pointer shadow-2xs"
              title="Tải lại danh sách"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
              <span>Làm mới</span>
            </button>

            <span className="text-xs text-slate-500 font-medium whitespace-nowrap bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
              Hiển thị <strong className="text-slate-900 font-bold">{filteredIssues.length}</strong> / {issues.length} yêu cầu
            </span>
          </div>
        </div>
      </div>

      {/* Main Table with Sticky Frozen Header */}
      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            <span className="text-xs font-semibold">Đang tải danh sách bản vẽ...</span>
          </div>
        ) : error ? (
          <div className="py-12 px-4 text-center">
            <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
            <p className="text-xs text-rose-600 font-semibold">{error}</p>
          </div>
        ) : filteredIssues.length === 0 ? (
          <div className="py-16 px-4 text-center">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-700">Chưa có yêu cầu đánh giá nào</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              {isAnyFilterActive
                ? 'Không tìm thấy yêu cầu phù hợp với bộ lọc hiện tại.'
                : 'Bắt đầu bằng cách phát hành yêu cầu đánh giá bản vẽ mới.'}
            </p>
          </div>
        ) : (
          <div
            className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-230px)] min-h-[420px]"
            data-testid="drawing-review-table-container"
          >
            <table
              className="w-full text-left text-xs border-collapse relative table-fixed"
              style={{ minWidth: `${totalTableWidth}px` }}
            >
              <colgroup>
                <col style={{ width: `${drawingColWidths.picture}px` }} />
                <col style={{ width: `${drawingColWidths.issue_no}px` }} />
                <col style={{ width: `${drawingColWidths.product}px` }} />
                <col style={{ width: `${drawingColWidths.customer}px` }} />
                <col style={{ width: `${drawingColWidths.routing}px` }} />
                <col style={{ width: `${drawingColWidths.issue_date}px` }} />
                <col style={{ width: `${drawingColWidths.version}px` }} />
                <col style={{ width: `${drawingColWidths.status}px` }} />
                <col style={{ width: `${drawingColWidths.actions}px` }} />
              </colgroup>
              <thead className="sticky top-0 z-20 bg-slate-50 shadow-xs">
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                  {/* 1. PICTURE */}
                  <th
                    data-testid="header-col-picture"
                    style={{ width: `${drawingColWidths.picture}px` }}
                    className="py-3.5 px-2 text-center bg-slate-50 sticky top-0 relative select-none"
                  >
                    <span>PICTURE</span>
                    <div
                      data-testid="resizer-picture"
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize select-none flex items-center justify-center z-30 group hover:bg-blue-400/30 active:bg-blue-500/50"
                      onMouseDown={(e) => handleResizeStart('picture', e)}
                      onDoubleClick={() => handleResetColumnWidth('picture')}
                      title="Kéo sang trái/phải để chỉnh độ rộng cột PICTURE. Nhấp đúp để đặt lại."
                    >
                      <div className="w-[1.5px] h-4 bg-slate-300 group-hover:bg-blue-600 transition-colors" />
                    </div>
                  </th>

                  {/* 2. ISSUE NO */}
                  <th
                    data-testid="header-col-issue_no"
                    style={{ width: `${drawingColWidths.issue_no}px` }}
                    className="py-3.5 px-3 text-left bg-slate-50 sticky top-0 relative select-none"
                  >
                    <span>ISSUE NO</span>
                    <div
                      data-testid="resizer-issue_no"
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize select-none flex items-center justify-center z-30 group hover:bg-blue-400/30 active:bg-blue-500/50"
                      onMouseDown={(e) => handleResizeStart('issue_no', e)}
                      onDoubleClick={() => handleResetColumnWidth('issue_no')}
                      title="Kéo sang trái/phải để chỉnh độ rộng cột ISSUE NO. Nhấp đúp để đặt lại."
                    >
                      <div className="w-[1.5px] h-4 bg-slate-300 group-hover:bg-blue-600 transition-colors" />
                    </div>
                  </th>

                  {/* 3. PRODUCT */}
                  <th
                    data-testid="header-col-product"
                    style={{ width: `${drawingColWidths.product}px` }}
                    className="py-3.5 px-3 text-left bg-slate-50 sticky top-0 relative select-none"
                  >
                    <span>PRODUCT</span>
                    <div
                      data-testid="resizer-product"
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize select-none flex items-center justify-center z-30 group hover:bg-blue-400/30 active:bg-blue-500/50"
                      onMouseDown={(e) => handleResizeStart('product', e)}
                      onDoubleClick={() => handleResetColumnWidth('product')}
                      title="Kéo sang trái/phải để chỉnh độ rộng cột PRODUCT. Nhấp đúp để đặt lại."
                    >
                      <div className="w-[1.5px] h-4 bg-slate-300 group-hover:bg-blue-600 transition-colors" />
                    </div>
                  </th>

                  {/* 4. CUSTOMER */}
                  <th
                    data-testid="header-col-customer"
                    style={{ width: `${drawingColWidths.customer}px` }}
                    className="py-3.5 px-3 text-left bg-slate-50 sticky top-0 relative select-none"
                  >
                    <span>CUSTOMER</span>
                    <div
                      data-testid="resizer-customer"
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize select-none flex items-center justify-center z-30 group hover:bg-blue-400/30 active:bg-blue-500/50"
                      onMouseDown={(e) => handleResizeStart('customer', e)}
                      onDoubleClick={() => handleResetColumnWidth('customer')}
                      title="Kéo sang trái/phải để chỉnh độ rộng cột CUSTOMER. Nhấp đúp để đặt lại."
                    >
                      <div className="w-[1.5px] h-4 bg-slate-300 group-hover:bg-blue-600 transition-colors" />
                    </div>
                  </th>

                  {/* 5. ROUTING */}
                  <th
                    data-testid="header-col-routing"
                    style={{ width: `${drawingColWidths.routing}px` }}
                    className="py-3.5 px-3 text-left bg-slate-50 sticky top-0 relative select-none"
                  >
                    <span>ROUTING</span>
                    <div
                      data-testid="resizer-routing"
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize select-none flex items-center justify-center z-30 group hover:bg-blue-400/30 active:bg-blue-500/50"
                      onMouseDown={(e) => handleResizeStart('routing', e)}
                      onDoubleClick={() => handleResetColumnWidth('routing')}
                      title="Kéo sang trái/phải để chỉnh độ rộng cột ROUTING. Nhấp đúp để đặt lại."
                    >
                      <div className="w-[1.5px] h-4 bg-slate-300 group-hover:bg-blue-600 transition-colors" />
                    </div>
                  </th>

                  {/* 6. ISSUE DATE */}
                  <th
                    data-testid="header-col-issue_date"
                    style={{ width: `${drawingColWidths.issue_date}px` }}
                    className="py-3.5 px-2 text-center bg-slate-50 sticky top-0 relative select-none"
                  >
                    <span>ISSUE DATE</span>
                    <div
                      data-testid="resizer-issue_date"
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize select-none flex items-center justify-center z-30 group hover:bg-blue-400/30 active:bg-blue-500/50"
                      onMouseDown={(e) => handleResizeStart('issue_date', e)}
                      onDoubleClick={() => handleResetColumnWidth('issue_date')}
                      title="Kéo sang trái/phải để chỉnh độ rộng cột ISSUE DATE. Nhấp đúp để đặt lại."
                    >
                      <div className="w-[1.5px] h-4 bg-slate-300 group-hover:bg-blue-600 transition-colors" />
                    </div>
                  </th>

                  {/* 7. VERSION */}
                  <th
                    data-testid="header-col-version"
                    style={{ width: `${drawingColWidths.version}px` }}
                    className="py-3.5 px-2 text-center bg-slate-50 sticky top-0 relative select-none"
                  >
                    <span>VERSION</span>
                    <div
                      data-testid="resizer-version"
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize select-none flex items-center justify-center z-30 group hover:bg-blue-400/30 active:bg-blue-500/50"
                      onMouseDown={(e) => handleResizeStart('version', e)}
                      onDoubleClick={() => handleResetColumnWidth('version')}
                      title="Kéo sang trái/phải để chỉnh độ rộng cột VERSION. Nhấp đúp để đặt lại."
                    >
                      <div className="w-[1.5px] h-4 bg-slate-300 group-hover:bg-blue-600 transition-colors" />
                    </div>
                  </th>

                  {/* 8. STATUS */}
                  <th
                    data-testid="header-col-status"
                    style={{ width: `${drawingColWidths.status}px` }}
                    className="py-3.5 px-2 text-center bg-slate-50 sticky top-0 relative select-none"
                  >
                    <span>STATUS</span>
                    <div
                      data-testid="resizer-status"
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize select-none flex items-center justify-center z-30 group hover:bg-blue-400/30 active:bg-blue-500/50"
                      onMouseDown={(e) => handleResizeStart('status', e)}
                      onDoubleClick={() => handleResetColumnWidth('status')}
                      title="Kéo sang trái/phải để chỉnh độ rộng cột STATUS. Nhấp đúp để đặt lại."
                    >
                      <div className="w-[1.5px] h-4 bg-slate-300 group-hover:bg-blue-600 transition-colors" />
                    </div>
                  </th>

                  {/* 9. Actions Column */}
                  <th
                    data-testid="header-col-actions"
                    style={{ width: `${drawingColWidths.actions}px` }}
                    className="py-3.5 px-2 text-center bg-slate-50 sticky top-0"
                  ></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredIssues.map((issue) => {
                  const latestVer = issue.latest_version;
                  const status = latestVer?.status || 'Issued';
                  const isPostReview = ['Completed', 'Quoted', 'Requote', 'Requoted'].includes(status);
                  const isPlusEnabled = status === 'Completed' || status === 'Requote';
                  const targetUrl = isPostReview
                    ? `/drawing-reviews/${issue.id}/report`
                    : `/drawing-reviews/${issue.id}`;

                  const activeOps = (latestVer?.operations || [])
                    .filter((op) => !op.is_removed)
                    .sort((a, b) => a.step_order - b.step_order);

                  return (
                    <tr
                      key={issue.id}
                      onClick={() => navigate(targetUrl)}
                      className="hover:bg-blue-50/40 cursor-pointer transition"
                      data-testid={`issue-row-${issue.issue_no}`}
                    >
                      {/* 1. PICTURE - Click opens Full Zoom/Pan Drawing Viewer Modal */}
                      <td className="py-2.5 px-2 text-center align-middle">
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            const isMouse = (e as any).pointerType === 'mouse' || (e.nativeEvent as any)?.pointerType === 'mouse';
                            const isTouch = !isMouse && (
                              (e as any).pointerType === 'touch' ||
                              (e.nativeEvent as any)?.pointerType === 'touch' ||
                              (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
                            );
                            if (!isTouch) {
                              setPreviewDrawingIssue(issue);
                            }
                          }}
                          className="cursor-pointer group relative inline-block"
                          title="Đưa chuột để xem to • Nhấp để mở toàn bộ bản vẽ"
                          data-testid={`picture-preview-trigger-${issue.issue_no}`}
                        >
                          <DrawingAvatarThumbnail
                            avatarFilePath={latestVer?.avatar_file_path || issue.drawing_file_path}
                            itemNo={issue.item_no}
                            itemName={issue.item_name}
                            size="lg"
                            className="mx-auto"
                            enableHoverZoom={true}
                            onOpenViewer={() => setPreviewDrawingIssue(issue)}
                          />
                          <div className="absolute inset-0 bg-blue-600/15 group-hover:bg-blue-600/25 rounded-xl transition flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none">
                            <Maximize2 className="w-4 h-4 text-blue-800 drop-shadow-xs" />
                          </div>
                        </div>
                      </td>

                      {/* 2. ISSUE NO */}
                      <td className="py-2.5 px-3 align-middle font-mono font-bold text-blue-600 hover:text-blue-800 transition">
                        {issue.issue_no}
                      </td>

                      {/* 3. PRODUCT (item_no and item_name) */}
                      <td className="py-2.5 px-3 align-middle overflow-hidden">
                        <div className="font-bold text-slate-900 text-xs sm:text-sm tracking-tight truncate">
                          {issue.item_no}
                        </div>
                        <div
                          className="text-[11px] text-slate-500 font-medium truncate mt-0.5"
                          title={issue.item_name}
                        >
                          {issue.item_name}
                        </div>
                      </td>

                      {/* 4. CUSTOMER */}
                      <td className="py-2.5 px-3 align-middle text-slate-800 font-semibold text-xs truncate overflow-hidden">
                        {issue.customer}
                      </td>

                      {/* 5. ROUTING: Auto-fits and wraps gracefully based on column width */}
                      <td className="py-2.5 px-3 align-middle overflow-hidden">
                        {activeOps.length === 0 ? (
                          <span className="text-slate-400 italic text-[11px]">— Chưa có routing —</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 py-1 w-full">
                            {activeOps.map((op, idx) => (
                              <div
                                key={op.id || idx}
                                className="inline-flex items-center justify-between gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-50 text-slate-800 border border-slate-200 shadow-2xs hover:bg-blue-50/60 hover:border-blue-300 transition truncate flex-1 min-w-[75px]"
                                title={
                                  op.operation_description
                                    ? `${op.workcenter_code}: ${op.operation_description}`
                                    : op.workcenter_code
                                }
                              >
                                <span className="font-bold text-slate-900 truncate">
                                  {op.workcenter_code}
                                </span>
                                {op.cycle_time_seconds != null && op.cycle_time_seconds > 0 ? (
                                  <span className="text-[10px] font-mono text-blue-600 font-bold shrink-0">
                                    ({op.cycle_time_seconds}s)
                                  </span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* 6. ISSUE DATE */}
                      <td className="py-2.5 px-2 text-center align-middle text-slate-600 font-mono text-xs whitespace-nowrap">
                        {formatHanoiDate(issue.created_at)}
                      </td>

                      {/* 7. VERSION */}
                      <td className="py-2.5 px-2 text-center align-middle whitespace-nowrap">
                        <span className="font-mono font-black text-xs text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                          {latestVer?.version_name || 'V1'}
                        </span>
                      </td>

                      {/* 8. STATUS (simplified: Completed, Reviewing, Issued) */}
                      <td className="py-2.5 px-2 text-center align-middle whitespace-nowrap">
                        <DrawingReviewStatusBadge status={status} simplified={true} />
                      </td>

                      {/* 9. Action icons (Eye & Plus) inline right at end */}
                      <td className="py-2.5 px-2 text-center align-middle whitespace-nowrap">
                        <div
                          className="flex items-center justify-center gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link
                            to={targetUrl}
                            className="p-1.5 text-blue-600 hover:bg-blue-100 hover:text-blue-800 rounded-lg transition"
                            title={isPostReview ? 'Xem báo cáo hoàn thành' : 'Đánh giá kỹ thuật'}
                            data-testid={`view-review-btn-${issue.issue_no}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Link>

                          {/* History / Audit Log Modal Button */}
                          <button
                            type="button"
                            onClick={() => setHistoryIssue(issue)}
                            className="p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 rounded-lg transition cursor-pointer"
                            title="Xem lịch sử thao tác & thay đổi trạng thái"
                            data-testid={`history-btn-${issue.issue_no}`}
                          >
                            <History className="w-4 h-4" />
                          </button>

                          {isPostReview && canCreateVersion && (
                            isPlusEnabled ? (
                              <button
                                type="button"
                                onClick={(e) =>
                                  handleCreateNextVersion(
                                    e,
                                    issue.id,
                                    issue.versions?.length || 1
                                  )
                                }
                                title={`Tạo phiên bản mới (V${(issue.versions?.length || 1) + 1})`}
                                className="p-1.5 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-800 rounded-lg transition cursor-pointer"
                                data-testid={`create-v-next-btn-${issue.issue_no}`}
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled
                                title={`Bản vẽ đang ở trạng thái ${status} (Đã báo giá). Cần bộ phận BD nhấn Requote để mở khóa trước khi tạo phiên bản mới.`}
                                className="p-1.5 text-slate-300 opacity-40 cursor-not-allowed rounded-lg"
                                data-testid={`create-v-next-btn-${issue.issue_no}-disabled`}
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* FULL DRAWING ZOOM & PAN VIEWER MODAL */}
      {previewDrawingIssue && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-2 sm:p-4 animate-in fade-in"
          onClick={() => setPreviewDrawingIssue(null)}
          data-testid="full-drawing-preview-modal"
        >
          <div
            className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden border border-slate-700 relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Top Bar */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800 border-b border-slate-700 text-white shrink-0">
              <div className="flex items-center gap-2.5 truncate">
                <span className="font-mono font-bold text-blue-400 text-xs sm:text-sm">
                  {previewDrawingIssue.issue_no}
                </span>
                <span className="text-slate-500 font-bold">|</span>
                <span className="font-bold text-white text-xs sm:text-sm truncate">
                  {previewDrawingIssue.item_no}
                </span>
                <span className="text-slate-400 text-xs hidden md:inline truncate">
                  — {previewDrawingIssue.item_name} ({previewDrawingIssue.customer})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewDrawingIssue(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition cursor-pointer"
                title="Đóng xem bản vẽ"
                data-testid="close-full-drawing-modal-btn"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawing Viewer Container */}
            <div className="flex-1 min-h-0 bg-slate-950 overflow-hidden relative">
              <DrawingViewer
                filePath={
                  previewDrawingIssue.drawing_file_path ||
                  previewDrawingIssue.latest_version?.avatar_file_path ||
                  ''
                }
                fileName={previewDrawingIssue.drawing_file_name || previewDrawingIssue.item_no}
                mimeType={previewDrawingIssue.drawing_mime_type || 'application/pdf'}
                fullHeight={true}
                canCropAvatar={false}
              />
            </div>
          </div>
        </div>
      )}

      {/* DRAWING REVIEW HISTORY MODAL */}
      {historyIssue && (
        <DrawingReviewHistoryModal
          issueId={historyIssue.id}
          issueNo={historyIssue.issue_no}
          itemNo={historyIssue.item_no}
          customer={historyIssue.customer}
          onClose={() => setHistoryIssue(null)}
        />
      )}
    </div>
  );
};
