// Shared MCP form rules for the renderer and the server.
globalThis.ForgePluginForms = {
  fields(schema) {
    if (schema?.type !== 'object' || !schema.properties || typeof schema.properties !== 'object') throw new Error('This plugin requested a form Forge cannot render. Open this flow in Codex.');
    const required = new Set(schema.required || []);
    return Object.entries(schema.properties).map(([key, field]) => {
      const options = field.enum?.map((value, index) => ({ value, label: field.enumNames?.[index] || String(value) }))
        || field.oneOf?.filter((option) => Object.hasOwn(option, 'const')).map((option) => ({ value: option.const, label: option.title || String(option.const) }));
      const item = field.items;
      const arrayOptions = item?.enum?.map((value) => ({ value, label: String(value) }))
        || item?.anyOf?.filter((option) => Object.hasOwn(option, 'const')).map((option) => ({ value: option.const, label: option.title || String(option.const) }));
      const type = field.type || (options?.length ? typeof options[0].value : null);
      if (!['string', 'number', 'integer', 'boolean'].includes(type) && !(type === 'array' && arrayOptions?.length)) throw new Error('This plugin form contains an unsupported field: ' + key);
      return { ...field, key, type, title: field.title || key, required: required.has(key), options: type === 'array' ? arrayOptions : options };
    });
  },
  validate(schema, content) {
    if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error('Fill in the requested plugin form.');
    const result = Object.create(null);
    for (const field of this.fields(schema)) {
      const value = content[field.key];
      if (value === undefined || value === null || value === '') {
        if (field.required) throw new Error('Complete ' + field.title + '.');
        continue;
      }
      if (field.type === 'string' && (typeof value !== 'string' || value.length < (field.minLength || 0) || value.length > Math.min(field.maxLength ?? 10000, 10000))) throw new Error('Check ' + field.title + '.');
      if (['number', 'integer'].includes(field.type) && (typeof value !== 'number' || !Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value)) || value < (field.minimum ?? -Infinity) || value > (field.maximum ?? Infinity))) throw new Error('Enter a valid number for ' + field.title + '.');
      if (field.type === 'boolean' && typeof value !== 'boolean') throw new Error('Choose Yes or No for ' + field.title + '.');
      if (field.type === 'array') {
        if (!Array.isArray(value) || value.length < (field.minItems || 0) || value.length > (field.maxItems ?? field.options.length) || value.some((item) => !field.options.some((option) => option.value === item))) throw new Error('Choose valid options for ' + field.title + '.');
      } else if (field.options?.length && !field.options.some((option) => option.value === value)) throw new Error('Choose an option for ' + field.title + '.');
      result[field.key] = value;
    }
    return result;
  },
};
