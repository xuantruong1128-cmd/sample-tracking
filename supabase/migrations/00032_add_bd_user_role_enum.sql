-- ============================================================================
-- Migration: 00032_add_bd_user_role_enum.sql
-- Description: Add 'BD' (Business Development) role to public.user_role enum.
-- Execution boundary: Dedicated migration file to satisfy PostgreSQL requirement
-- where ALTER TYPE ... ADD VALUE cannot be referenced in the same transaction block.
-- ============================================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'BD';
