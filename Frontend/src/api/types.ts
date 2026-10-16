/* ===========================================================================
 * Shared types for the ERP frontend.
 * ==========================================================================*/
export interface User {
  id: number;
  displayId: string;
  username: string;
  fullName: string;
  isAdmin: boolean;
}

export interface Branch {
  id: number;
  code: string;
  parentId: number | null;
  level: number;
  name: string;
  shortName: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  isActive: boolean;
  children?: Branch[];
}

export interface Account {
  code: string;
  parentCode: string | null;
  level: number;
  name: string;
  nature: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  isGroup: boolean;
  isCash?: boolean;
  isBank?: boolean;
  partyType?: 'NONE' | 'CUSTOMER' | 'SUPPLIER';
  isActive: boolean;
  children?: Account[];
}

export interface Unit {
  id: number;
  displayId: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface Store {
  id: number;
  code: string;
  parentId: number | null;
  level: number;
  name: string;
  storeType: 'GROUP' | 'STOCK';
  isActive: boolean;
  taggedBranches?: number[];
  children?: Store[];
}

export interface ProductNode {
  id: number;
  code: string;
  parentId: number | null;
  level: number;
  name: string;
  unitId: number | null;
  salesTaxPct: number;
  reorderLevel: number;
  purchasePrice: number;
  salesPrice: number;
  isGroup: boolean;
  isActive: boolean;
  children?: ProductNode[];
}
