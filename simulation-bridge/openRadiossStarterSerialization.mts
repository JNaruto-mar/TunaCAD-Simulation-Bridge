// Standalone OpenRadioss probe formatting only; this is not provider admission.
export const RADIOSSS_FIELD_RULER = '#---1----|----2----|----3----|----4----|----5----|----6----|----7----|----8----|----9----|---10----|';

export function fixedField(value: string | number, width: 10 | 20): string {
  const text = String(value);
  if (!text || text.length > width || /[\r\n]/.test(text)) throw new Error('Invalid fixed-width Radioss field');
  return text.padStart(width);
}

export function beginBlock(name: string): string[] {
  if (!/^[A-Za-z][A-Za-z0-9_-]{3,79}$/.test(name)) throw new Error('Invalid Radioss run name');
  const units = ['Mg', 'mm', 's'].map(unit => fixedField(unit, 20)).join('');
  return ['/BEGIN', name, fixedField(2026, 10), units, units];
}

export function bcsBlock(groupId: number): string[] {
  if (!Number.isSafeInteger(groupId) || groupId < 1) throw new Error('Invalid fixed node group');
  // Positions 4-6 are Tx/Ty/Tz; positions 8-10 are rotational DOFs.
  const trarot = '   111 000';
  return ['/BCS/1', 'Fixed translations', trarot + fixedField(0, 10) + fixedField(groupId, 10)];
}

export function solidTetra4Block(): string[] {
  // Fields 1..8: Isolid, Ismstr, Iale, Icpre, Itetra10, Inpts, Itetra4, Iframe.
  // Isolid is a brick setting and is not selected for the linear tetrahedron.
  const formulation = [0, 1, 0, 0, 0, 0, 1000, 1].map(v => fixedField(v, 10)).join('') + fixedField(0, 20);
  const defaultReals = Array(5).fill(fixedField(0, 20)).join('');
  return ['/PROP/SOLID/1', 'Linear tetra small strain', formulation,
    defaultReals, defaultReals, [0, 0, 0].map(v => fixedField(v, 10)).join('')];
}
