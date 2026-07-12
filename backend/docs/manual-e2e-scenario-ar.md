# سيناريو الاختبار الشامل لـ Khaliduo

هذا السيناريو مخصص لاختبار قبول يدوي كامل للنسخة الحالية، من إنشاء بيانات الشركة وحتى التقارير والصلاحيات والحالات الاستثنائية.

## قواعد التنفيذ

- نفّذ السيناريو على بيانات اختبار فقط.
- استخدم Run ID موحدًا مثل `QA-20260711-01` داخل كل الأسماء لتسهيل البحث والتنظيف.
- أمام كل خطوة سجّل: `PASS` أو `FAIL`، النتيجة الفعلية، ولقطة شاشة عند الفشل.
- لا تنتقل للمرحلة التالية إذا فشلت خطوة حرجة مثل تسجيل الدخول أو ربط الجهاز أو بدء جلسة التتبع.
- احتفظ بقيم الإعدادات الأصلية قبل تغييرها ثم أعدها في مرحلة التنظيف.

## بيانات الاختبار

استبدل `<RUN>` بالـRun ID الذي اخترته.

| النوع | القيمة المقترحة |
|---|---|
| Team Owner | `QA Owner <RUN>` / `qa.owner.<RUN>@example.test` |
| Employee A | `QA Employee A <RUN>` / `qa.employee.a.<RUN>@example.test` / `QA-A-<RUN>` |
| Employee B | `QA Employee B <RUN>` / `qa.employee.b.<RUN>@example.test` / `QA-B-<RUN>` |
| Team A | `QA Team A <RUN>` |
| Team B | `QA Team B <RUN>` |
| Project A | `QA Project A <RUN>` |
| Project B | `QA Project B <RUN>` |
| Task A1 | `QA Task A1 <RUN>` |
| Task A2 | `QA Task A2 <RUN>` |
| Task B1 | `QA Task B1 <RUN>` |

## 0. بوابة ما قبل الاختبار

- [ ] شغّل `npm.cmd run validate` من جذر المشروع، أو شغّل مراحل التحقق منفصلة إذا كان مجلد Windows Temp محظورًا.
- [ ] تأكد أن `GET http://127.0.0.1:8000/api/v1/health` يرجع `success: true`.
- [ ] افتح `http://localhost:5174` وتأكد من ظهور صفحة تسجيل دخول الإدارة.
- [ ] افتح `http://localhost:5174/employee` وتأكد من ظهور بوابة الموظف.
- [ ] افتح `http://localhost:5174/download` وتأكد من ظهور صفحة تنزيل Windows.
- [ ] جرّب رابطًا غير موجود وتأكد من ظهور صفحة 404 مفهومة.

النتيجة المتوقعة: لا توجد شاشة بيضاء، أخطاء JavaScript ظاهرة، أو استجابة 5xx.

## 1. تسجيل دخول General Admin

- [ ] أدخل بريدًا أو كلمة مرور خاطئة؛ يجب رفض الدخول برسالة واضحة دون كشف تفاصيل حساسة.
- [ ] سجّل الدخول بحساب General Admin صحيح.
- [ ] فعّل واختبر خيار تذكر تسجيل الدخول، ثم افتح الصفحة من جديد.
- [ ] تأكد من ظهور كل عناصر القائمة: Overview، Teams، Projects & Tasks، Employees، Live Activity، Screenshots، Timesheets، Time Requests، Devices، Reports، Tracking Settings، Users & Roles، Audit Log.
- [ ] تأكد أن اسم المستخدم ودوره يظهران بصورة صحيحة.

## 2. إعدادات التتبع المؤقتة

- [ ] افتح Tracking Settings وسجّل القيم الأصلية.
- [ ] غيّر Screenshot interval إلى 5 minutes.
- [ ] غيّر Screenshots per interval إلى 2.
- [ ] فعّل Enable screenshots.
- [ ] عطّل Capture during idle لاختبار توقف الصور أثناء الخمول.
- [ ] اجعل Idle threshold = 1 minute وOffline threshold = 1 minute.
- [ ] اضغط Save changes وتأكد من رسالة النجاح وبقاء القيم بعد تحديث الصفحة.
- [ ] غيّر قيمة دون حفظ وتأكد من ظهور تحذير unsaved changes، ثم اختبر Discard.
- [ ] جرّب قيمة غير صالحة مثل 0 وتأكد من منع الحفظ.

## 3. إنشاء المستخدم والفرق والموظفين

### المستخدم والصلاحية

- [ ] من Users & Roles أنشئ Team Owner بالبيانات المقترحة وكلمة مرور اختبار قوية.
- [ ] تأكد من ظهور المستخدم بدور Team owner وحالة Active.

### الفرق

- [ ] أنشئ Team A وTeam B.
- [ ] اختبر البحث والفلترة حسب الحالة.
- [ ] افتح Team A وأضف Team Owner في تبويب Owners.
- [ ] لا تضف Team Owner إلى Team B؛ هذا الفصل سيستخدم لاختبار الصلاحيات.

### الموظفون

- [ ] أنشئ Employee A وEmployee B من Employees.
- [ ] جرّب إنشاء موظف بنفس البريد وتأكد من رفض التكرار برسالة مفهومة.
- [ ] أضف Employee A إلى Team A وEmployee B إلى Team B.
- [ ] افتح تفاصيل كل موظف وتحقق من Profile والحالة الحالية وعدم وجود جهاز قبل الربط.
- [ ] اختبر البحث والفلاتر: Team، Department، Status.

## 4. إنشاء المشاريع والمهام

- [ ] أنشئ Project A داخل Team A وProject B داخل Team B.
- [ ] أنشئ Task A1 وTask A2 داخل Project A وTask B1 داخل Project B.
- [ ] اختبر عرض Kanban وعرض List.
- [ ] حرّك Task A1 عبر المراحل: New requests ثم Assigned ثم In progress.
- [ ] اختبر البحث والفلترة حسب Team وProject.
- [ ] اترك Task A1 في In progress ليختاره تطبيق Employee A لاحقًا.

## 5. مفاتيح Employee A

- [ ] من تفاصيل Employee A > Enrollment أنشئ كود ربط صالحًا لمدة يوم واحد وانسخه فورًا.
- [ ] تأكد أن الكود يبدأ بـ`KH-` وأن النص الكامل لا يظهر مجددًا بعد تحديث الصفحة.
- [ ] أنشئ كود ربط ثانيًا ثم اعمل له Revoke؛ سنستخدمه لاختبار الرفض.
- [ ] من Employee portal أنشئ مفتاح ويب وانسخه فورًا.
- [ ] تأكد أن مفتاح الويب يبدأ بـ`KHW-` وأنه مختلف عن كود ربط الجهاز.

## 6. تنزيل وتثبيت تطبيق Windows

- [ ] من `/download` نزّل `KhaliduoSetup.exe` وتأكد أن التنزيل يبدأ وأن الملف غير فارغ.
- [ ] ثبّت التطبيق على Windows test profile أو VM نظيف ووافق على طلب Administrator عند الحاجة.
- [ ] تأكد من إنشاء اختصار Desktop واختصار Start menu.
- [ ] شغّل التطبيق وتأكد من ظهور شعار Khaliduo وحقل Enrollment Code.
- [ ] تأكد من وجود أيقونة الدرع في Windows notification area.

## 7. ربط الجهاز وبدء الجلسة

- [ ] أدخل قيمة عشوائية؛ يجب رفضها دون ربط الجهاز.
- [ ] أدخل الكود الذي تم عمل Revoke له؛ يجب رفضه.
- [ ] أدخل كود Employee A الصحيح؛ يجب نجاح الربط وبدء التتبع.
- [ ] حاول استخدام نفس الكود مرة أخرى على Windows profile آخر؛ يجب رفضه لأنه single-use.
- [ ] تحقق من اسم الموظف والجهاز وحالة Active والاتصال وآخر مزامنة.
- [ ] من Current work اختر Task A1 وتأكد من ظهور Team A وProject A.
- [ ] من لوحة الإدارة افتح Live Activity وEmployee A وDevices؛ يجب أن يظهر الجهاز Online/Active مع Windows user وIP والإصدار.

## 8. التتبع والصور والحالات

- [ ] اعمل بشكل نشط عدة دقائق وتأكد أن Worked Today وActive Time يزدادان.
- [ ] خلال دورة الـ5 دقائق تأكد من وصول صورة أو صورتين إلى Screenshots في لوحة الإدارة.
- [ ] افتح الصورة وتأكد من وضوحها وربطها بـEmployee A وTeam A وProject A وTask A1.
- [ ] استخدم فلاتر Employee وTeam والتاريخ ثم Reset.
- [ ] اضغط Pause tracking؛ يجب أن تصبح الحالة Paused وتتوقف الصور والوقت النشط.
- [ ] أغلق نافذة التطبيق واختبر خيارات keep tracking / pause / quit، ثم أعد فتحها من أيقونة الدرع.
- [ ] من قائمة أيقونة الدرع اختبر Pause وResume.
- [ ] أعد تشغيل التطبيق بعد Paused؛ يجب أن يظل Paused حتى تضغط Resume.
- [ ] اضغط Resume tracking وتأكد من بدء جلسة/مزامنة سليمة.

### Idle وLock وSleep

- [ ] اترك الجهاز دون إدخال لمدة تتجاوز دقيقة؛ يجب أن تصبح الحالة Idle ويزداد Idle Time.
- [ ] مع Capture during idle معطل، تأكد من عدم التقاط صور أثناء Idle.
- [ ] عند تحريك الماوس اختبر كل فرع من نافذة العودة من الخمول في دورة مستقلة: Continue tracking، Stop tracking، Request manual time.
- [ ] اقفل Windows ثم افتحه؛ يجب ظهور Locked ثم العودة دون صور أثناء القفل.
- [ ] نفّذ Sleep ثم Resume؛ يجب ظهور Sleeping/Offline مؤقتًا ثم استعادة المزامنة.

### انقطاع الشبكة

- [ ] افصل الشبكة أثناء جلسة Active واستمر بالعمل لدقيقتين.
- [ ] تأكد أن التطبيق لا ينهار وأن الأحداث/الصور المعلقة تحفظ محليًا.
- [ ] أعد الشبكة وتأكد من رفع البيانات المعلقة وتحديث Last Sync دون تكرار الجلسات أو الصور.

## 9. بوابة الموظف وطلبات الوقت

- [ ] من تطبيق Windows اضغط My web dashboard؛ يجب فتح Employee A مباشرة عبر handoff صالح لمرة قصيرة.
- [ ] سجّل الخروج ثم ادخل يدويًا من `/employee` بالبريد ومفتاح `KH-`؛ يجب الرفض.
- [ ] ادخل بالبريد ومفتاح `KHW-` الصحيح؛ يجب النجاح.
- [ ] تحقق من Today وThis week وThis month والوقت النشط والخامل والصور والنقاط.
- [ ] تأكد أن Assigned tasks يعرض مهام Team A فقط ولا يعرض Task B1.
- [ ] تأكد أن My screenshots يعرض صور Employee A فقط.
- [ ] أرسل طلب 30 دقيقة بسبب `Offline QA meeting <RUN>`؛ يجب أن يظهر Pending ولا يدخل في الوقت المعتمد أو النقاط.
- [ ] أرسل طلبًا ثانيًا 15 دقيقة بسبب `Rejected QA request <RUN>`.

## 10. مراجعة طلبات الوقت والحسابات

- [ ] كـGeneral Admin افتح Time Requests وابحث عن Employee A.
- [ ] وافق على طلب 30 دقيقة وارفض طلب 15 دقيقة.
- [ ] حدّث بوابة الموظف؛ يجب ظهور Approved وRejected بصورة صحيحة.
- [ ] تأكد أن Approved 30 دقيقة دخلت في manual approved والوقت/النقاط، وأن Pending/Rejected لا تدخل.
- [ ] راجع Timesheets في Daily وWeekly وMonthly وتأكد من active، idle، manual adjustment، deductions، total، screenshot count.
- [ ] صدّر CSV وافتحه وتأكد من صحة الأعمدة والموظف والفترة والأرقام.

## 11. حذف صورة وخصم الوقت

- [ ] قبل الحذف سجّل Active time وDeducted time وعدد الصور في Employee A/Timesheets.
- [ ] احذف صورة واحدة من لوحة الإدارة واقرأ رسالة التأكيد بعناية.
- [ ] تأكد أن الصورة اختفت من لوحة الإدارة ومن بوابة Employee A.
- [ ] تأكد أن وقت الصورة المحتسب خُصم مرة واحدة فقط من الجلسة، وأن Deducted time زاد بالقيمة المتوقعة.
- [ ] حدّث الصفحة وتأكد أن الحذف لم يتكرر وأن الصورة لا يمكن فتحها من رابطها القديم.
- [ ] تأكد من وجود حدث delete screenshot في Audit Log مع قيمة deducted seconds.

## 12. Dashboard والتقارير

- [ ] افتح Overview وتأكد أن الأرقام تتفق مع بيانات Employee A المنفذة في السيناريو.
- [ ] افتح Reports واختر نطاق تاريخ اليوم وTeam A ثم Employee A.
- [ ] قارن Total hours وActive وIdle وScreenshots مع Timesheets.
- [ ] تأكد من صحة Hours by team وActive vs idle وHours by employee.
- [ ] صدّر تقرير CSV وتأكد من احترام فلاتر التاريخ والفريق والموظف.
- [ ] افتح Team A وتحقق من Overview وMembers وOwners وLive Activity وScreenshots وTimesheets وDevices.

## 13. صلاحيات Team Owner

- [ ] سجّل الخروج ثم ادخل بحساب Team Owner.
- [ ] تأكد من عدم ظهور Users & Roles وAudit Log.
- [ ] تأكد أن Tracking Settings للقراءة فقط ولا يمكن حفظ تعديل.
- [ ] تأكد من رؤية Team A وEmployee A وProject A وTask A وصوره وتقاريره فقط.
- [ ] تأكد من عدم رؤية Team B أو Employee B أو Project B أو Task B1 في القوائم والفلاتر والبحث.
- [ ] جرّب فتح URL مباشر لسجل Team B أو Employee B إن توفر لديك ID؛ يجب أن يرجع 403/404 مناسبًا دون تسريب بيانات.
- [ ] تأكد أن Team Owner لا يرى تبويبي Enrollment وEmployee portal ولا يستطيع إدارة أكواد الجهاز.
- [ ] تأكد أن Team Owner لا يستطيع Approve/Reject طلب الوقت لأن ذلك مخصص لـGeneral Admin.

## 14. الأجهزة وإلغاء الصلاحية

- [ ] عد إلى General Admin وافتح جهاز Employee A.
- [ ] اختبر تعديل اسم الجهاز إن كانت الواجهة تعرضه.
- [ ] اضغط Revoke device ووافق على رسالة التأكيد.
- [ ] تأكد أن تطبيق Windows يفقد صلاحية المزامنة ولا يستطيع إنشاء جلسة أو رفع صورة جديدة.
- [ ] تأكد أن البيانات التاريخية القديمة ما زالت مرئية للإدارة.
- [ ] أنشئ كود Enrollment جديدًا وأعد الربط عند الحاجة لإكمال اختبارات لاحقة.

## 15. مفتاح بوابة الموظف والجلسات

- [ ] اختر Replace portal key وسجّل الخروج من بوابة الموظف.
- [ ] تأكد أن المفتاح القديم يفشل وأن المفتاح الجديد ينجح.
- [ ] اختر Revoke access، ثم سجّل الخروج واختبر أن تسجيل الدخول بالمفتاح الأخير يفشل.
- [ ] لاحظ أن access token الموجود قبل Revoke قد يظل صالحًا حتى انتهاء مدته؛ الاختبار الحاسم هو تسجيل دخول جديد بعد Logout.

## 16. Audit Log

- [ ] تأكد من تسجيل العمليات الإدارية الرئيسية: إنشاء مستخدم، فريق، موظف، مشروع/مهمة، إعدادات، مفاتيح، مراجعة طلب، حذف صورة، وإلغاء جهاز.
- [ ] اختبر الفلاتر حسب User وAction وEntity والتاريخ.
- [ ] تأكد أن السجل لا يعرض كلمات المرور أو الأكواد الكاملة أو مفاتيح الوصول.

## 17. تحديث التطبيق

- [ ] تأكد أن `/api/v1/updates/windows/latest.yml` يعمل وأن ملفات EXE وblockmap الخاصة بنفس الإصدار متاحة.
- [ ] على جهاز عليه إصدار أقدم، شغّل التطبيق وانتظر فحص التحديث.
- [ ] تأكد من تنزيل الإصدار الأحدث وعرض Restart now وLater.
- [ ] اختبر Later ثم نفّذ التحديث من قائمة أيقونة الدرع.
- [ ] بعد Restart تأكد من الإصدار الجديد وبقاء هوية الجهاز وحالة Pause/Resume كما كانت.

## 18. Logout والتنظيف

- [ ] اختبر Logout من General Admin وTeam Owner وEmployee Portal وتأكد من حماية الصفحات بعد الخروج.
- [ ] أعد Tracking Settings إلى القيم الأصلية.
- [ ] عطّل مستخدم Team Owner التجريبي وتأكد من فشل دخوله الجديد.
- [ ] اعمل Revoke لأي أكواد Enrollment أو Portal keys متبقية.
- [ ] Archive المشاريع/المهام والفرق التجريبية أو احذف بيانات QA وفق سياسة بيئة الاختبار.
- [ ] تأكد أن بيانات غير مرتبطة بالـRun ID لم تتغير.

## معيار النجاح النهائي

يعتبر السيناريو ناجحًا عندما:

- لا توجد أي خطوة حرجة Failed.
- الحسابات متطابقة بين Employee Portal وTimesheets وReports.
- الصور لا تظهر خارج نطاق الموظف/الفريق المصرح به.
- Pause وIdle وLock وSleep وانقطاع الشبكة لا تسبب صورًا أو وقتًا غير صحيح.
- أكواد Enrollment أحادية الاستخدام، والمفاتيح الملغاة لا تسمح بتسجيل دخول جديد.
- Team Owner معزول تمامًا عن Team B وبياناته.
- لا تظهر أسرار في الواجهة أو Audit Log أو رسائل الخطأ.
