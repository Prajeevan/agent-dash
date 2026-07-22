// Shared bits for the Project → Task → Thread views.

const PALETTE = ['#8b6dff', '#4ec7a8', '#5b9bff', '#f2b34d', '#ff7a92', '#c78bff', '#4dd0d8', '#ff9d6b']

export function projectColor(name: string): string {
  if (!name) return '#6b6b83'
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export const KIND_LABEL: Record<string, string> = {
  update: 'Update',
  question: 'Question',
  done: 'Done',
  error: 'Error',
}
export const KIND_COLOR: Record<string, string> = {
  update: 'var(--info)',
  question: 'var(--accent)',
  done: 'var(--success)',
  error: 'var(--error)',
}

// The "No project" bucket is project === ''. URLs can't carry an empty segment,
// so map it to a reserved token both ways.
const NONE = '__none__'
export function toParam(project: string): string {
  return project === '' ? NONE : project
}
export function fromParam(name: string): string {
  return name === NONE ? '' : name
}
export function projectLabel(project: string): string {
  return project === '' ? 'No project' : project
}
