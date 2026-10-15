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
  id: number;
  code: string;
  parentId: number | null;
  level: number;
  name: string;
  nature: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  isGroup: boolean;
  isCash?: boolean;
  isBank?: boolean;
  partyType?: 'NONE' | 'CUSTOMER' | 'SUPPLIER';
  contactPerson?: string | null;
  partyAddress?: string | null;
  partyPhone?: string | null;
  partyEmail?: string | null;
  partyNtnCnic?: string | null;
  creditDays?: number | null;
  creditLimit?: number | null;
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankBranch?: string | null;
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
