import { describe, expect, it } from 'vitest';
import { buildInstallContract, calcTermination, contractHealth, getAROExpectedEnd, remainingContractMonths } from '../src/lib/contract';
import { MOVEMENT_RULES, STATUS, can } from '../src/lib/constants';

const customer = { id: 'c1', name: 'PT Contoh', email: 'a@b.c', value: 150000, contractDuration: 12, scheme: 'Sewa' };

describe('kontrak per unit', () => {
  it('install: kontrak mulai di tanggal transaksi dan berakhir sesuai durasi customer', () => {
    const c = buildInstallContract(customer, new Date('2026-01-15T00:00:00Z'));
    expect(c.contractStatus).toBe('Active');
    expect(c.expectedEndDate.slice(0, 10)).toBe('2027-01-15');
    expect(c.currentMonthlyRental).toBe(150000);
    expect(c.contractCustomerId).toBe('c1');
    expect(c.penaltyAmount).toBe(0);
  });

  it('install: durasi kosong / 0 memakai default 12 bulan', () => {
    const c = buildInstallContract({ ...customer, contractDuration: 0 }, new Date('2026-01-15T00:00:00Z'));
    expect(c.expectedEndDate.slice(0, 10)).toBe('2027-01-15');
  });

  it('sisa bulan dibulatkan ke atas', () => {
    expect(remainingContractMonths(new Date('2026-01-15'), new Date('2026-07-15'))).toBe(6);
    expect(remainingContractMonths(new Date('2026-01-16'), new Date('2026-07-15'))).toBe(6);
    expect(remainingContractMonths(new Date('2026-01-14'), new Date('2026-07-15'))).toBe(7);
    expect(remainingContractMonths(new Date('2026-07-14'), new Date('2026-07-15'))).toBe(1);
    expect(remainingContractMonths(new Date('2026-07-15'), new Date('2026-07-15'))).toBe(0);
  });

  it('tarik sebelum kontrak habis: denda = sisa bulan x sewa', () => {
    const asset = { contractStatus: 'Active', expectedEndDate: '2027-01-15T00:00:00.000Z', currentMonthlyRental: 150000 };
    const t = calcTermination(asset, new Date('2026-10-15T00:00:00Z'))!;
    expect(t.contractStatus).toBe('Terminated (Early)');
    expect(t.remainingMonthsAtTermination).toBe(3);
    expect(t.penaltyAmount).toBe(450000);
    expect(t.isTerminatedInARO).toBe(false);
  });

  it('tarik tepat di tanggal akhir kontrak: tanpa denda', () => {
    const asset = { contractStatus: 'Active', expectedEndDate: '2027-01-15T00:00:00.000Z', currentMonthlyRental: 150000 };
    const t = calcTermination(asset, new Date('2027-01-15T00:00:00Z'))!;
    expect(t.contractStatus).toBe('Terminated (Normal)');
    expect(t.penaltyAmount).toBe(0);
  });

  it('tarik di masa ARO: denda dihitung dari akhir periode perpanjangan', () => {
    const asset = { contractStatus: 'Active', expectedEndDate: '2026-01-15T00:00:00.000Z', currentMonthlyRental: 100000 };
    const t = calcTermination(asset, new Date('2026-11-15T00:00:00Z'))!;
    expect(t.isTerminatedInARO).toBe(true);
    expect(t.remainingMonthsAtTermination).toBe(2);
    expect(t.penaltyAmount).toBe(200000);
  });

  it('unit tanpa kontrak aktif tidak menghasilkan pengakhiran', () => {
    expect(calcTermination({ contractStatus: undefined, expectedEndDate: undefined }, new Date())).toBeNull();
    expect(calcTermination({ contractStatus: 'Terminated (Early)', expectedEndDate: '2026-01-01' }, new Date())).toBeNull();
  });

  it('ARO menggeser akhir kontrak per 12 bulan dan tahan terhadap tanggal rusak', () => {
    const end = getAROExpectedEnd('2024-03-01T00:00:00.000Z', 12, new Date('2026-06-01T00:00:00Z'))!;
    expect(end.toISOString().slice(0, 10)).toBe('2027-03-01');
    expect(getAROExpectedEnd('bukan-tanggal')).toBeNull();
    expect(getAROExpectedEnd(undefined)).toBeNull();
  });

  it('kesehatan kontrak', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    expect(contractHealth({ contractStatus: 'Active', expectedEndDate: '2026-12-01T00:00:00Z' }, now).health).toBe('active');
    expect(contractHealth({ contractStatus: 'Active', expectedEndDate: '2026-06-20T00:00:00Z' }, now).health).toBe('ending');
    expect(contractHealth({ contractStatus: 'Active', expectedEndDate: '2025-12-01T00:00:00Z' }, now).health).toBe('aro');
    expect(contractHealth({ contractStatus: 'Terminated (Early)', expectedEndDate: '2026-12-01T00:00:00Z' }, now).health).toBe('terminated');
    expect(contractHealth({}, now).health).toBe('none');
  });
});

describe('aturan pergerakan & hak akses', () => {
  it('unit terpasang hanya bisa direlokasi atau ditarik', () => {
    const allowed = MOVEMENT_RULES.filter(r => r.from.includes(STATUS.INSTALLED)).map(r => r.type);
    expect(allowed.sort()).toEqual(['Relocation', 'Withdrawal']);
  });

  it('hanya Install yang menghasilkan status terpasang dari stok', () => {
    const toInstalled = MOVEMENT_RULES.filter(r => r.to.includes(STATUS.INSTALLED) && !r.from.includes(STATUS.INSTALLED));
    expect(toInstalled.map(r => r.type)).toEqual(['Install']);
  });

  it('matriks role', () => {
    expect(can('Admin', 'users.manage')).toBe(true);
    expect(can('Operations', 'users.manage')).toBe(false);
    expect(can('Management', 'assets.update')).toBe(false);
    expect(can('Account Manager', 'customers.write')).toBe(true);
    expect(can('Account Manager', 'movements.create')).toBe(false);
    expect(can('Service', 'assets.create')).toBe(false);
    expect(can(null, 'assets.update')).toBe(false);
    expect(can('RoleNgarang', 'assets.update')).toBe(false);
  });
});

describe('data lama', () => {
  it('unit berstatus tak dikenal hanya bisa dinormalkan, tidak terkunci', async () => {
    const { checkEligibility } = await import('../src/lib/movements');
    const { movementRule } = await import('../src/lib/constants');
    const legacy: any = { id: 'x', sn: 'OLD-1', assetType: 'perangkat', status: 'Relocated' };
    expect(checkEligibility(movementRule('Install')!, [legacy]).blocked).toHaveLength(1);
    expect(checkEligibility(movementRule('Return to Stock')!, [legacy]).eligible).toHaveLength(1);
  });

  it('kontrak lama tanpa nilai sewa memakai nilai sewa customer', async () => {
    const { terminationFor, withdrawalDateProblem } = await import('../src/lib/movements');
    const asset: any = { id: 'x', sn: 'OLD-2', contractStatus: 'Active', contractStartDate: '2026-01-15T00:00:00.000Z', expectedEndDate: '2027-01-15T00:00:00.000Z' };
    const t = terminationFor(asset, { id: 'c', name: 'C', email: '', value: 200000 }, new Date('2026-11-15T00:00:00Z'))!;
    expect(t.penaltyAmount).toBe(400000);
    expect(withdrawalDateProblem([asset], '2026-01-10')).toMatch(/lebih awal/);
    expect(withdrawalDateProblem([asset], '2026-01-15')).toBeNull();
  });

  it('SIM / peripheral dan unit beda customer tidak ikut satu transaksi', async () => {
    const { checkEligibility } = await import('../src/lib/movements');
    const { movementRule } = await import('../src/lib/constants');
    const a: any = { id: 'a', sn: 'A', assetType: 'perangkat', status: 'Installed / Active', currentCustomerId: 'c1' };
    const b: any = { id: 'b', sn: 'B', assetType: 'perangkat', status: 'Installed / Active', currentCustomerId: 'c2' };
    const sim: any = { id: 's', sn: 'S', assetType: 'sim', status: 'Installed / Active', currentCustomerId: 'c1' };
    const r = checkEligibility(movementRule('Withdrawal')!, [a, b, sim]);
    expect(r.eligible.map(x => x.sn)).toEqual(['A']);
    expect(r.blocked.map(x => x.asset.sn).sort()).toEqual(['B', 'S']);
  });
});
