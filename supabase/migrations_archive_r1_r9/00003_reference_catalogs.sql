-- ==============================================================================
-- SAMPLE TRACKING V1.0 — PRODUCTION REFERENCE CATALOGS
-- Migration: 00003_reference_catalogs.sql (F-14 Remediation)
-- Description: Standard manufacturing reference data (defect catalog only).
-- NOTE: Does NOT contain demonstration jobs. Safe for production deployment.
-- ==============================================================================

-- 1. DEFECT CATALOG SEED
INSERT INTO public.defect_catalog (code, name_vi, name_en, category, is_active)
VALUES
    ('DEF-01', 'Bavia / Ba-vớ cạnh', 'Burr / Edge Burr', 'Machining', TRUE),
    ('DEF-02', 'Trầy xước bề mặt', 'Surface Scratch', 'Appearance', TRUE),
    ('DEF-03', 'Sai kích thước đường kính ngoài (OD)', 'Outer Diameter (OD) Out of Spec', 'Dimension', TRUE),
    ('DEF-04', 'Sai kích thước chiều dài (Length)', 'Length Out of Spec', 'Dimension', TRUE),
    ('DEF-05', 'Độ nhám bề mặt không đạt (Ra/Rz)', 'Surface Roughness High', 'Surface', TRUE),
    ('DEF-06', 'Cong vênh / Độ đảo vượt dung sai', 'Runout / Deflection', 'Geometric', TRUE),
    ('DEF-07', 'Mẻ dao / Vết cắt dao gián đoạn', 'Tool Chipping / Chatter Mark', 'Machining', TRUE),
    ('DEF-08', 'Lỗi lớp mạ / Bong tróc xi mạ', 'Plating Peeling / Blister', 'Plating', TRUE),
    ('DEF-09', 'Dính dầu bẩn / Oxy hóa rỉ sét', 'Contamination / Rust', 'Appearance', TRUE),
    ('DEF-10', 'Sai bước ren / Kẹt dưỡng ren', 'Thread Pitch Error / No-Go Thread', 'Machining', TRUE)
ON CONFLICT (code) DO NOTHING;
