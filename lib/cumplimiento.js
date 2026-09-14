// Documentos institucionales firmables (políticas) y firma electrónica simple:
// el firmante se autentica con su cuenta (CIP o correo), confirma su cargo y
// hace clic en "Firmar" — la app registra quién, con qué cargo, cuándo y sobre
// qué versión exacta del contenido. Si el admin edita el contenido, la versión
// sube y las firmas anteriores quedan ligadas a la versión que realmente
// firmaron (no se re-interpretan como válidas para el texto nuevo).

export async function listarDocumentosInstitucionales(supabase) {
  const { data, error } = await supabase
    .from("documentos_institucionales")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listarFirmasDocumentos(supabase) {
  const { data, error } = await supabase
    .from("firmas_documentos")
    .select("*")
    .order("firmado_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function firmarDocumento(supabase, { documentoId, version, firmanteId, nombre, grado, cargo }) {
  const { error } = await supabase.from("firmas_documentos").insert({
    documento_id: documentoId,
    documento_version: version,
    firmante_id: firmanteId,
    firmante_nombre: nombre,
    firmante_grado: grado || null,
    firmante_cargo: cargo,
  });
  if (error) throw error;
}

export async function actualizarContenidoDocumentoInstitucional(supabase, { id, contenido, version, userId }) {
  const { error } = await supabase
    .from("documentos_institucionales")
    .update({ contenido, version: version + 1, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
