# Análisis del modelo de suscripción

Fecha: 18 de noviembre de 2026, Colombia.

## Conclusión

La mejor oportunidad es vender una mejora voluntaria para gestionar y hacer crecer las ventas de los negocios que ya usan el catálogo. El catálogo de pago único debe conservar lo comprado. Para un cliente Premium, ampliar límites tiene poco atractivo: necesita un resultado adicional que pueda experimentar y medir.

Primero corregir la experiencia de prueba y pago, conciliar las suscripciones y validar la propuesta con los negocios que ya reciben pedidos. Después invertir en funciones nuevas.

## Alcance y evidencia

Se revisaron las rutas, registro, acceso a módulos, catálogo, checkout, dashboard, productos, clientes, pedidos, cupones, kits, configuración, superadministración, carga de archivos y migraciones de suscripción. Se consultó en modo lectura la base configurada en el proyecto. No se modificaron cuentas, pagos, permisos ni datos comerciales.

Los datos representan registros del sistema; no acreditan por sí solos cobros reales, ventas completadas o personas distintas. La condición `registration_type = token` se usa como aproximación a compra única según la implementación. No se conciliaron registros contra dLocal Go/Make ni se recuperó la oferta comercial original. No se verificó visualmente toda la interfaz ni se hizo una auditoría completa de las políticas desplegadas.

### Situación observada

| Indicador | Resultado |
| --- | ---: |
| Tiendas | 45 |
| Tiendas registradas por token | 39 |
| Pago único Basic / Pro / Premium | 5 / 6 / 28 |
| Tiendas por token con productos | 33 |
| Tiendas por token con pedidos históricos | 30 |
| Tiendas por token con pedidos en los últimos 30 días | 11 |
| Distribución de esas 11: Premium / Pro / Basic | 9 / 1 / 1 |
| Productos registrados | 11.681 |
| Pedidos registrados | 393 |
| Pedidos nuevos / entregados | 391 / 2 |
| Pedidos en ventana reciente | 191, todos en estado nuevo |
| Registros de clientes | 309 |
| Cupones / kits registrados | 1 / 3 |
| Cuentas con tipo de registro `paid` | 2, ambas con fecha de acceso vencida |

Ventana reciente: desde el 19 de octubre de 2026 a las 00:00 de Colombia hasta el corte de consulta del 18 de noviembre. No se equipara un pedido creado con una venta pagada o entregada. Los registros pueden incluir pruebas y no se excluyeron por nombre.

Hay cuatro pagos con estado aprobado: dos de USD 15, uno de COP 39.900 y otro de MXN 49.900, asociados a dos tiendas. Estos son importes históricos registrados, no una tarifa vigente verificada. No deben sumarse monedas ni usarse para estimar ingresos recurrentes.

Dos de esos pagos están asociados a una tienda que conserva `registration_type = token` y plan Basic. Otra cuenta marcada `paid` no tiene pagos asociados en esta tabla. Esto exige conciliación antes de clasificar clientes o comunicar vencimientos. No demuestra por sí solo un fallo de la pasarela: puede haber ajustes manuales, migraciones o pruebas.

## Qué ya se puede vender

La base ofrece catálogo, productos, categorías, variantes, imágenes, videos según plan, carrito, pedidos por WhatsApp, configuración comercial e importación de productos. La suscripción separa cuatro módulos: Pedidos, Clientes, Cupones y Kits.

| Función existente | Beneficio que conviene mostrar | Mejora necesaria |
| --- | --- | --- |
| Pedidos y estados | Identificar qué falta confirmar, preparar o entregar | Acciones rápidas, avisos y recorrido guiado |
| Historial de clientes | Encontrar compradores recurrentes y oportunidades de recompra | Segmentos simples y seguimiento manual asistido |
| Cupones | Lanzar una promoción con mínimo de compra y límites | Plantillas y resultados por promoción |
| Kits | Facilitar la compra de varios productos juntos | Ayuda para crear el primer combo y medir su venta |

Los beneficios comerciales son hipótesis a validar. La existencia de estas funciones no demuestra incremento de ventas. El escaso cambio de estados y la baja cantidad de cupones y kits sugieren investigar adopción; también pueden explicarse por restricciones de acceso.

## Frenos concretos a la conversión

1. **La prueba no habilita los módulos de la mensualidad.** En `hooks/useSubscriptionAccess.ts`, `allowed` admite una prueba vigente, mientras `paidModulesAllowed` exige estado activo y registro pagado. Pedidos, Clientes, Cupones y Kits usan este segundo permiso. La función SQL `has_paid_monthly_access` también exige pago. Una prueba real requiere cambios consistentes en servidor, base e interfaz; no basta con quitar un candado.
2. **La oferta se oculta durante los primeros siete días.** `tokenIntroActive` oculta los cuatro módulos y la opción de suscripción; `SubscriptionOptionRoute` redirige a Productos. La condición depende de la fecha y de no tener acceso pagado, sin exigir registro por token, así que también afecta a pruebas recientes. Sustituirla por una invitación contextual que no interrumpa la configuración inicial.
3. **Los candados no explican el valor.** `Sidebar.tsx` renderiza los módulos bloqueados como elementos sin navegación. Permitir abrir una demostración con datos ficticios claramente identificados o una vista previa autorizada. No exponer datos reales saltándose controles.
4. **La pantalla no presenta precio, moneda y condiciones junto al botón.** Hay beneficios y un enlace fijo a dLocal Go, pero no una oferta completa verificable dentro de la aplicación. Mostrar importe y periodicidad desde una configuración coherente con la pasarela, más condiciones de renovación y cancelación.
5. **El pago depende de copiar el correo.** La interfaz abre un enlace genérico y el endpoint busca la tienda por `contact_email`; la pantalla muestra el email del usuario autenticado. Vincular la compra a una referencia estable de tienda y reconciliar el resultado. Verificar primero qué soporta la integración concreta de dLocal Go/Make.
6. **El panel no prueba rentabilidad.** `DashboardView.tsx` suma los últimos 50 pedidos sin filtrar por estado y lo llama ingresos. Separar pedidos creados, confirmados, entregados y ventas cobradas cuando exista evidencia de cobro. No atribuir ingresos a la suscripción sin medirlos.
7. **El panel de superadministración confunde estado con tipo de compra.** Considera activo un token con fecha vigente, aunque no tenga mensualidad. Añadir columnas independientes de compra base, acceso a funciones, fecha de vencimiento y último pago conciliado.

## Oferta recomendada para clientes actuales

**Nombre de trabajo: Ventas y seguimiento.** Una suscripción adicional al catálogo comprado, inicialmente con un único paquete fácil de entender.

- Conservar la versión y los límites que el cliente adquirió originalmente.
- Incluir los cuatro módulos existentes y una configuración inicial guiada: primer combo, primera promoción y revisión de pedidos pendientes.
- Ofrecer una prueba voluntaria de 14 días para clientes actuales elegibles, con acceso real a los beneficios. Evitar cobros al terminar la prueba sin una contratación explícita.
- Al terminar, mantener el catálogo base y los datos. Explicar de antemano qué acciones y publicaciones adicionales se pausan, y permitir consultar o exportar el historial propio mediante permisos definidos.
- Dar una ventaja de fundador limitada y transparente, si los márgenes lo permiten; por ejemplo, descuento durante los tres primeros meses. Medir retención después del descuento.

Mensaje sugerido: “Tu catálogo de pago único sigue siendo tuyo. Ahora puedes añadir seguimiento de pedidos, historial de compradores, cupones y combos. Te ayudamos a configurarlos para tu negocio y puedes probarlos durante 14 días”.

La ayuda inicial debe ser acotada y presupuestada; soporte ilimitado o campañas realizadas permanentemente pueden consumir el margen.

### Precio

No fijar una tarifa definitiva a partir de los scripts de prueba o de los pagos históricos. La oferta vigente de la pasarela y las condiciones de compra originales no quedaron verificadas.

Calcular primero costos de infraestructura, comisiones, soporte y obligaciones de la base de pago único. Estimar el valor económico para el negocio con margen, no solo con ventas brutas:

`pedidos adicionales necesarios = redondear hacia arriba(cuota mensual / margen de contribución por pedido)`

Ejemplo únicamente ilustrativo: una cuota de COP 39.900 y un margen de contribución de COP 15.000 por pedido requieren tres pedidos adicionales para cubrirla. No es un resultado demostrado ni una recomendación de precio.

## A quién ofrecerlo primero

1. **11 tiendas con pedidos recientes**, de las cuales nueve son Premium. Validar cuáles corresponden a negocios reales, revisar que no tengan pagos pendientes de conciliar y presentar una demostración basada en sus necesidades.
2. **19 tiendas con pedidos históricos pero sin pedidos recientes.** Entender por qué dejaron de usarlo antes de ofrecer una mensualidad. Puede faltar tráfico, productos actualizados o seguimiento.
3. **9 tiendas sin pedidos históricos.** Priorizar publicación, configuración y difusión del catálogo. Cobrar por funciones avanzadas antes de que reciban pedidos probablemente encuentre más resistencia.

No se enviaron mensajes ni campañas a estos clientes.

## Orden de mejoras

| Prioridad | Trabajo | Criterio para avanzar |
| --- | --- | --- |
| P0 | Conciliar pagos, acceso y tipo de compra | Cada pago tiene tienda, período y resultado verificable |
| P0 | Preservar derecho base independiente de la suscripción | Activar y cancelar devuelve exactamente la compra original |
| P0 | Mostrar oferta completa y estado coherente | Cliente entiende cuánto paga, por qué y qué ocurre al cancelar |
| P1 | Demostraciones y prueba voluntaria real | Puede experimentar los cuatro beneficios con permisos correctos |
| P1 | Configuración guiada y llamadas contextuales | Completa su primera acción de valor |
| P1 | Medición de activación, pago y retención | Se identifican los puntos de abandono |
| P2 | Segmentos de clientes y seguimiento manual por WhatsApp | Hay uso repetido y demanda observada |
| P2 | Reportes por período, estado, promoción y kit | Muestran datos completos y definiciones correctas |
| P3 | Inventario avanzado, automatizaciones o integraciones | Clientes dispuestos a pagar y operación técnicamente fiable |

La automatización de WhatsApp y la recuperación de carritos no deben venderse como funciones existentes. Un carrito guardado localmente no equivale a un contacto recuperable ni a permiso para enviar mensajes.

## Aspectos técnicos que afectan confianza y margen

- La activación actual sustituye `plan` por `subscription` y `registration_type` por `paid`. Mantener por separado el plan base adquirido y la suscripción, incluyendo permisos y límites originales. Cancelar no debería dejar a un antiguo Basic con beneficios ilimitados ni quitarle su compra.
- El endpoint de activación tiene secreto compartido e identificador de evento. En el código revisado no valida directamente estado aprobado, importe esperado ni referencia contra el proveedor: esa validación podría estar en Make, cuya configuración no se revisó. Confirmar el contrato de eventos y manejar renovaciones, rechazo, cancelación, devolución y duplicados.
- La activación suma 30 días por evento. Conciliar el período con las fechas reales de la pasarela para no confundir una mensualidad de calendario con 30 días.
- `updateOrderStatus` valida propietario pero no comprueba mensualidad en el servidor. Alinear las operaciones pagadas con la política de permisos elegida; un bloqueo de React no es suficiente.
- Los endpoints de carga, firma y eliminación de R2 revisados no autentican al solicitante ni comprueban propiedad de la ruta. Corregir antes de ampliar adquisición: pueden afectar archivos y costos.
- Los tokens de registro de planes son estáticos y aparecen en frontend. Sustituirlos por invitaciones individuales verificadas en servidor para no regalar altas por compartir una URL o inspeccionar el código.
- La creación de pedidos/clientes/items usa varias escrituras; el consumo del cupón hace lectura e incremento separados. Para fiabilidad bajo concurrencia, diseñar operaciones atómicas y comprobar inventario en servidor antes de ofrecerlo como control garantizado.
- El dashboard necesita agregaciones completas por período. La vista de clientes carga la lista y pagina en memoria; pasar a paginación en servidor cuando el volumen lo justifique.
- El README contiene afirmaciones desactualizadas sobre migraciones y pruebas. Actualizarlo para que no sea la fuente de decisiones operativas erróneas.

## Piloto y medición

Propuesta de cuatro semanas, comenzando después de resolver los puntos P0:

1. Revisar los 11 candidatos activos y elegir 5–8 negocios reales para un primer piloto. Conocer su tarea principal y registrar el punto de partida.
2. Activar una prueba voluntaria y ayudar a crear un combo o promoción y revisar pedidos. Registrar qué beneficio usan realmente.
3. Mostrar un resumen de uso con métricas verificables y ofrecer la contratación con condiciones completas.
4. Recoger motivos de contratación y rechazo. No ampliar el desarrollo por visitas a la pantalla: buscar uso repetido y primer pago.

Eventos mínimos: invitación mostrada, demostración abierta, prueba iniciada, primer beneficio usado, checkout iniciado, pago confirmado, renovación confirmada y cancelación. Una visita o un inicio de checkout no cuenta como suscripción.

Medir conversión por tienda elegible, activación durante la prueba, primer pago y retención a 30/60/90 días, junto con costo de soporte y margen. El piloto de cuatro semanas solo permite una primera señal: la retención posterior requiere seguimiento.

Objetivo experimental, no pronóstico: conseguir 3–5 contrataciones iniciales entre los 11 negocios con pedidos recientes y comprobar que renuevan. Con una muestra tan pequeña, priorizar aprendizaje y motivos de decisión sobre porcentajes aparentemente precisos.

## Verificación y límites

Las consultas de base fueron de lectura y se completó la paginación de los 11.681 productos para no inferir actividad a partir de una muestra de 1.000 filas. La comprobación TypeScript (`node node_modules/typescript/bin/tsc --noEmit`) terminó correctamente. No se ejecutaron las pruebas integrales existentes porque crean usuarios y simulan pagos sobre la base configurada. La compilación de Vite no pudo completarse en el entorno restringido por un error de acceso a directorios; no se atribuye ese resultado a un defecto de la aplicación.

Fuentes externas oficiales para las capacidades generales de cobro recurrente y cancelación de dLocal Go:

- https://helpcenter.dlocalgo.com/es/articles/7925846-conociendo-las-suscripciones
- https://helpcenter.dlocalgo.com/es/articles/7925913-como-puedo-cancelar-la-suscripcion-de-un-solo-cliente

Estas fuentes no confirman el importe ni la configuración del plan particular usado por esta aplicación.
