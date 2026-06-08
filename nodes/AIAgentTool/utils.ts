export function substituteVariables(template: string, variables: Record<string, string>): string {
	return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => variables[key] ?? '');
}
