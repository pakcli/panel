import assert from 'assert';

function unindentLines(inner) {
	let lines = inner.replace(/\r\n/g, '\n').split('\n');
	while (lines.length > 0 && lines[0].trim() === '') {
		lines.shift();
	}
	while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
		lines.pop();
	}
	if (lines.length === 0) return '';

	let minIndent = Infinity;
	for (const line of lines) {
		if (line.trim().length === 0) continue;
		const indentMatch = line.match(/^[ \t]+/);
		const indentLen = indentMatch ? indentMatch[0].length : 0;
		if (indentLen < minIndent) minIndent = indentLen;
	}

	if (minIndent > 0 && minIndent !== Infinity) {
		lines = lines.map((line) => {
			if (line.trim().length === 0) return '';
			return line.slice(minIndent);
		});
	}

	return lines.join('\n');
}

function unwrapExistingWrapper(content) {
	const s = (content || '').replace(/\r\n/g, '\n').trim();
	if (!s) return content;

	// 1. .{\n ... \n} or .{ ... }
	const dotMatch = s.match(/^\.\s*\{([\s\S]*)\}\s*$/);
	if (dotMatch) {
		return unindentLines(dotMatch[1]);
	}

	// 2. @{\n ... \n} or @{ ... }
	const atMatch = s.match(/^@\s*\{([\s\S]*)\}\s*$/);
	if (atMatch) {
		return unindentLines(atMatch[1]);
	}

	// 3. {\n ... \n}.invoke() or {\n ... \n}invoke() or { ... }.invoke()
	const invokeMatch = s.match(/^\{([\s\S]*)\}\s*\.?\s*in[vc]oke\s*(?:\(\s*\))?\s*$/i);
	if (invokeMatch) {
		return unindentLines(invokeMatch[1]);
	}

	// 4. {\n ... \n} (plain script block wrapper)
	const braceMatch = s.match(/^\{([\s\S]*)\}\s*$/);
	if (braceMatch) {
		return unindentLines(braceMatch[1]);
	}

	return content;
}

function transformClipboardContent(content, template, language, replaceExisting = true) {
	let raw = (content || '').replace(/\r\n/g, '\n').trimEnd();
	const t = (template || '').trim();

	const isPowerShell = ['powershell', 'ps1', 'pwsh', 'ps'].includes((language || '').trim().toLowerCase());

	if (replaceExisting && isPowerShell) {
		raw = unwrapExistingWrapper(raw);
	}

	if (!t) return raw;

	const indentWith = (str, indent = '\t') => {
		return str
			.split('\n')
			.map((line) => (line.length > 0 ? indent + line : line))
			.join('\n');
	};

	// 1. PowerShell Presets
	const isInvoke = t === 'invoke' || t === '{}.invoke()' || t === '{}.invoke' || t === '{}.incvoke' || /\{\s*\}\s*\.?\s*in[vc]oke/i.test(t);
	const isDot = t === 'dot' || t === '.{}' || t === '. prefix' || /^\s*\.\s*\{\s*\}\s*$/i.test(t);
	const isAt = t === 'at' || t === '@{}' || t === '@ prefix' || /^\s*@\s*\{\s*\}\s*$/i.test(t) || t.includes("'@'");

	if (isInvoke) {
		return `{\n${indentWith(raw, '\t')}\n}.invoke()`;
	}
	if (isDot) {
		return `.{\n${indentWith(raw, '\t')}\n}`;
	}
	if (isAt) {
		return `@{\n${indentWith(raw, '\t')}\n}`;
	}

	// 2. Custom template with placeholder keyword
	const placeholderRegex = /<scripts>|scripts|<content>|content|\{scripts\}|\{content\}|\$content/i;
	if (placeholderRegex.test(t)) {
		const lines = t.split('\n');
		let indent = '\t';
		for (const line of lines) {
			const match = line.match(/^([ \t]+)(?:<scripts>|scripts|<content>|content|\{scripts\}|\{content\}|\$content)/i);
			if (match) {
				indent = match[1];
				break;
			}
		}
		const indented = raw
			.split('\n')
			.map((l, i) => (i === 0 ? l : (l.length > 0 ? indent + l : l)))
			.join('\n');
		return t.replace(placeholderRegex, indented);
	}

	// 3. Dot-block template without placeholder: .{ ... } or { ... }.invoke()
	const dotBlockMatch = t.match(/^(\s*\.\s*\{)([\s\S]*?)(\}\s*)$/);
	if (dotBlockMatch) {
		return `${dotBlockMatch[1]}\n${indentWith(raw, '\t')}\n${dotBlockMatch[3]}`;
	}

	const invokeBlockMatch = t.match(/^(\s*\{)([\s\S]*?)(\}\s*\.?\s*in[vc]oke\s*(?:\(\s*\))?\s*)$/i);
	if (invokeBlockMatch) {
		return `${invokeBlockMatch[1]}\n${indentWith(raw, '\t')}\n}.invoke()`;
	}

	const genericBraceMatch = t.match(/^([\s\S]*?\{)([\s\S]*?)(\}[\s\S]*)$/);
	if (genericBraceMatch) {
		return `${genericBraceMatch[1]}\n${indentWith(raw, '\t')}\n${genericBraceMatch[3]}`;
	}

	return `${t}\n${raw}`;
}

// ─── TESTS ───
console.log("=== TEST 1: Unwrap .{} and wrap with {}.invoke() ===");
const inputDot = `.{\n\tasdasdas\n}`;
const outInvoke = transformClipboardContent(inputDot, '{}.invoke()', 'powershell', true);
console.log(outInvoke);
assert.strictEqual(outInvoke, `{\n\tasdasdas\n}.invoke()`);

console.log("=== TEST 2: Unwrap {}.invoke() and wrap with .{} ===");
const inputInvoke = `{\n\tasdasdas\n}.invoke()`;
const outDot = transformClipboardContent(inputInvoke, '.{}', 'powershell', true);
console.log(outDot);
assert.strictEqual(outDot, `.{\n\tasdasdas\n}`);

console.log("=== TEST 3: Unwrap @{} and wrap with {}.invoke() ===");
const inputAt = `@{\n\tasdasdas\n}`;
const outAtToInvoke = transformClipboardContent(inputAt, '{}.invoke()', 'powershell', true);
console.log(outAtToInvoke);
assert.strictEqual(outAtToInvoke, `{\n\tasdasdas\n}.invoke()`);

console.log("=== TEST 4: Multiline with existing wrapper ===");
const inputMulti = `.{\n\tWrite-Host "Line 1"\n\tWrite-Host "Line 2"\n}`;
const outMulti = transformClipboardContent(inputMulti, '{}.invoke()', 'powershell', true);
console.log(outMulti);
assert.strictEqual(outMulti, `{\n\tWrite-Host "Line 1"\n\tWrite-Host "Line 2"\n}.invoke()`);

console.log("=== TEST 5: Raw code without existing wrapper ===");
const inputRaw = `asdasdas`;
const outRaw = transformClipboardContent(inputRaw, '{}.invoke()', 'powershell', true);
console.log(outRaw);
assert.strictEqual(outRaw, `{\n\tasdasdas\n}.invoke()`);

console.log("=== TEST 6: replaceExisting: false (do NOT replace existing wrapper) ===");
const outNoReplace = transformClipboardContent(inputDot, '{}.invoke()', 'powershell', false);
console.log(outNoReplace);
assert.strictEqual(outNoReplace, `{\n\t.{\n\t\tasdasdas\n\t}\n}.invoke()`);

console.log("=== TEST 7: Template none with replaceExisting: true (strips wrapper) ===");
const outStrip = transformClipboardContent(inputDot, '', 'powershell', true);
console.log(outStrip);
assert.strictEqual(outStrip, `asdasdas`);

console.log("\nALL WRAPPER REPLACEMENT TESTS PASSED PERFECTLY!");
