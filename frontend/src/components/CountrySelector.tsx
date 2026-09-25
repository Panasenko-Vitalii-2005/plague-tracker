import { useState } from 'react'
import type { SessionCountry } from '../api/types.ts'
import { formatCountryName } from '../domain/countries.ts'

export function CountrySelector({ countries, selectedId, onChange, controlId }: {
  countries: readonly SessionCountry[]
  selectedId: string | null
  onChange(id: string): void
  controlId: string
}) {
  const [query, setQuery] = useState('')
  const filter = query.trim().toLocaleLowerCase()
  const visible = filter ? countries.filter((country) =>
    country.id.toLocaleLowerCase().includes(filter)
    || formatCountryName(country.id).toLocaleLowerCase().includes(filter)) : countries
  const visibleSelected = visible.some((country) => country.id === selectedId)

  return <div className="country-selector">
    <label htmlFor={`${controlId}-search`}>Search country</label>
    <input id={`${controlId}-search`} type="search" value={query}
      onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${countries.length} countries…`} />
    <div className="country-selector-meta"><label htmlFor={controlId}>Country</label>
      <span>{visible.length} / {countries.length}</span></div>
    <select id={controlId} value={visibleSelected ? selectedId ?? '' : ''}
      onChange={(event) => onChange(event.target.value)} disabled={visible.length === 0}>
      <option value="" disabled>{visible.length === 0 ? 'No matching countries' : 'Choose a country'}</option>
      {visible.map((country) => <option value={country.id} key={country.id}>
        {formatCountryName(country.id)}</option>)}
    </select>
    {visible.length === 0 && <p className="selector-empty">No matching countries.</p>}
  </div>
}
