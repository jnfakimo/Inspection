// 異常事件的結構化個資：只接受必要欄位，避免把任意前端物件寫入交接紀錄。
export type GuardIncidentPerson = { name: string; id_number: string; phone: string };

export function normalizeGuardIncidentPeople(value: unknown): GuardIncidentPerson[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 10) return null;
  const people: GuardIncidentPerson[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (typeof item.name !== 'string' || typeof item.id_number !== 'string' || typeof item.phone !== 'string') return null;
    const name = item.name.trim(), id_number = item.id_number.trim().toUpperCase(), phone = item.phone.trim();
    if (!name || name.length > 40 || (id_number && !/^[A-Z][12]\d{8}$/.test(id_number))
      || (phone && (!/^[+0-9][0-9 ()-]{5,23}$/.test(phone) || !/^\d{8,15}$/.test(phone.replace(/\D/g, ''))))) return null;
    people.push({ name, id_number, phone });
  }
  return people;
}

export function incidentPersonMatches(person: GuardIncidentPerson, field: 'name' | 'id_number' | 'phone', query: string): boolean {
  if (field === 'name') return person.name.includes(query);
  if (field === 'id_number') return person.id_number.toUpperCase() === query.toUpperCase();
  return person.phone.replace(/\D/g, '') === query.replace(/\D/g, '');
}
