# Sanitation Team Performance Program (Excel VBA)

Use the code below to build **`Sanitation_Team_Performance_Program.xlsm`** for a Monday–Sunday weekly sanitation audit workflow.

---

## 1) Full VBA Code

### Module 1: `modProgramSetup`

```vba
Option Explicit

Public Const FIRST_TASK_ROW As Long = 11
Public Const LAST_TASK_ROW As Long = 70

Public Sub BuildSanitationProgramWorkbook()
    Dim ws As Worksheet

    Application.ScreenUpdating = False
    Application.DisplayAlerts = False

    ' Remove existing target sheets if they already exist
    DeleteSheetIfExists "Shift 1 - Weekly"
    DeleteSheetIfExists "Shift 2 - Weekly"
    DeleteSheetIfExists "Dashboard"
    DeleteSheetIfExists "Settings"

    ' Create sheets in required order
    Set ws = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
    ws.Name = "Shift 1 - Weekly"
    BuildShiftSheet ws, 1

    Set ws = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
    ws.Name = "Shift 2 - Weekly"
    BuildShiftSheet ws, 2

    Set ws = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
    ws.Name = "Dashboard"
    BuildDashboard ws

    Set ws = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
    ws.Name = "Settings"
    BuildSettings ws
    ws.Visible = xlSheetVeryHidden

    Application.DisplayAlerts = True
    Application.ScreenUpdating = True

    MsgBox "Workbook structure created successfully.", vbInformation
End Sub

Private Sub DeleteSheetIfExists(ByVal sheetName As String)
    On Error Resume Next
    ThisWorkbook.Worksheets(sheetName).Delete
    On Error GoTo 0
End Sub

Private Sub BuildShiftSheet(ByVal ws As Worksheet, ByVal shiftNo As Long)
    Dim headers As Variant
    Dim i As Long, r As Long
    Dim statusCols As Variant, statusCol As Variant
    Dim dayStatusCol As Variant, dayFindCol As Variant, dayActionCol As Variant
    Dim dayNames As Variant

    ws.Cells.Clear
    ws.Cells.Font.Name = "Calibri"
    ws.Cells.Font.Size = 10

    ws.Range("A1").Value = "Sanitation Team Weekly Performance - Shift " & shiftNo
    ws.Range("A1").Font.Size = 16
    ws.Range("A1").Font.Bold = True

    ws.Range("A2").Value = "Site / Department"
    ws.Range("A3").Value = "Prepared by"
    ws.Range("D2").Value = "Week Selector"
    ws.Range("G2").Value = "Month Selector"
    ws.Range("J2").Value = "Week Start Date"
    ws.Range("D3").Value = "Supervisor verification"

    ws.Range("B2").Name = "Dept_" & shiftNo
    ws.Range("E2").Name = "WeekSel_" & shiftNo
    ws.Range("H2").Name = "MonthSel_" & shiftNo
    ws.Range("K2").Name = "WeekStart_" & shiftNo

    ws.Range("B2").Value = GetDefaultDepartment
    ws.Range("B3").Value = ""
    ws.Range("E2").Value = "Week 1"
    ws.Range("H2").Value = "January"
    ws.Range("E3").Value = ""

    ws.Range("E2").Validation.Delete
    ws.Range("E2").Validation.Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, _
        Operator:=xlBetween, Formula1:="Week 1,Week 2,Week 3,Week 4"

    ws.Range("H2").Validation.Delete
    ws.Range("H2").Validation.Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, _
        Operator:=xlBetween, Formula1:="January,February,March,April,May,June,July,August,September,October,November,December"

    ws.Range("K2").Formula = "=IF(OR(H2=\"\",E2=\"\"),\"\",DATE(YEAR(TODAY()),MATCH(H2,{\"January\",\"February\",\"March\",\"April\",\"May\",\"June\",\"July\",\"August\",\"September\",\"October\",\"November\",\"December\"},0),1)+MOD(2-WEEKDAY(DATE(YEAR(TODAY()),MATCH(H2,{\"January\",\"February\",\"March\",\"April\",\"May\",\"June\",\"July\",\"August\",\"September\",\"October\",\"November\",\"December\"},0),1),2),7)+7*(VALUE(RIGHT(E2,1))-1))"
    ws.Range("K2").NumberFormat = "mm/dd/yyyy"

    ws.Range("A4").Value = "Prepared by Signature"
    ws.Range("D4").Value = "Supervisor Signature"
    DrawSignatureBox ws, "B4", "Signature"
    DrawSignatureBox ws, "E4", "Signature"

    headers = Array("Item No.", "Inspection Area / Task", "Standard / Requirement", _
                    "Monday", "Monday Findings", "Monday Corrective Action", _
                    "Tuesday", "Tuesday Findings", "Tuesday Corrective Action", _
                    "Wednesday", "Wednesday Findings", "Wednesday Corrective Action", _
                    "Thursday", "Thursday Findings", "Thursday Corrective Action", _
                    "Friday", "Friday Findings", "Friday Corrective Action", _
                    "Saturday", "Saturday Findings", "Saturday Corrective Action", _
                    "Sunday", "Sunday Findings", "Sunday Corrective Action", _
                    "Weekly NC Count", "Weekly Compliance %", "Comments")

    For i = 0 To UBound(headers)
        ws.Cells(10, i + 1).Value = headers(i)
    Next i

    With ws.Range("A10:AA10")
        .Interior.Color = RGB(31, 78, 121)
        .Font.Color = vbWhite
        .Font.Bold = True
        .WrapText = True
        .HorizontalAlignment = xlCenter
        .VerticalAlignment = xlCenter
    End With

    For r = FIRST_TASK_ROW To LAST_TASK_ROW
        ws.Cells(r, "A").Value = r - FIRST_TASK_ROW + 1
        ws.Cells(r, "Y").Formula = BuildNCFormula(r)
        ws.Cells(r, "Z").Formula = BuildComplianceFormula(r)
        ws.Cells(r, "Z").NumberFormat = "0.0%"
    Next r

    statusCols = Array("D", "G", "J", "M", "P", "S", "V")
    For Each statusCol In statusCols
        With ws.Range(statusCol & FIRST_TASK_ROW & ":" & statusCol & LAST_TASK_ROW)
            .Validation.Delete
            .Validation.Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, Operator:=xlBetween, Formula1:="C,NC"
            .HorizontalAlignment = xlCenter
            .Font.Bold = True
        End With
    Next statusCol

    ' Status color formatting
    For Each statusCol In statusCols
        With ws.Range(statusCol & FIRST_TASK_ROW & ":" & statusCol & LAST_TASK_ROW)
            .FormatConditions.Delete
            .FormatConditions.Add Type:=xlCellValue, Operator:=xlEqual, Formula1:="=\"NC\""
            .FormatConditions(.FormatConditions.Count).Interior.Color = RGB(192, 0, 0)
            .FormatConditions(.FormatConditions.Count).Font.Color = vbWhite
            .FormatConditions(.FormatConditions.Count).Font.Bold = True

            .FormatConditions.Add Type:=xlCellValue, Operator:=xlEqual, Formula1:="=\"C\""
            .FormatConditions(.FormatConditions.Count).Interior.Color = RGB(0, 176, 80)
            .FormatConditions(.FormatConditions.Count).Font.Color = vbWhite
            .FormatConditions(.FormatConditions.Count).Font.Bold = True
        End With
    Next statusCol

    ' Findings + Corrective Action conditional formatting
    dayStatusCol = Array("D", "G", "J", "M", "P", "S", "V")
    dayFindCol = Array("E", "H", "K", "N", "Q", "T", "W")
    dayActionCol = Array("F", "I", "L", "O", "R", "U", "X")
    dayNames = Array("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

    For i = LBound(dayStatusCol) To UBound(dayStatusCol)
        ApplyEntryConditionFormatting ws, CStr(dayStatusCol(i)), CStr(dayFindCol(i)), CStr(dayActionCol(i))
    Next i

    ' Compliance % color threshold
    With ws.Range("Z" & FIRST_TASK_ROW & ":Z" & LAST_TASK_ROW)
        .FormatConditions.Delete
        .FormatConditions.Add Type:=xlCellValue, Operator:=xlLess, Formula1:="=0.95"
        .FormatConditions(.FormatConditions.Count).Font.Color = vbRed
        .FormatConditions.Add Type:=xlCellValue, Operator:=xlGreaterEqual, Formula1:="=0.95"
        .FormatConditions(.FormatConditions.Count).Font.Color = RGB(0, 128, 0)
        .HorizontalAlignment = xlCenter
    End With

    ' Borders and widths
    With ws.Range("A10:AA" & LAST_TASK_ROW)
        .Borders.LineStyle = xlContinuous
        .Borders.Weight = xlThin
        .VerticalAlignment = xlTop
    End With

    ws.Columns("A").ColumnWidth = 7
    ws.Columns("B").ColumnWidth = 22
    ws.Columns("C").ColumnWidth = 22
    ws.Columns("D:X").ColumnWidth = 14
    ws.Columns("Y").ColumnWidth = 12
    ws.Columns("Z").ColumnWidth = 14
    ws.Columns("AA").ColumnWidth = 20

    ws.Range("B" & FIRST_TASK_ROW & ":C" & LAST_TASK_ROW).WrapText = True
    ws.Range("E" & FIRST_TASK_ROW & ":X" & LAST_TASK_ROW).WrapText = True
    ws.Range("AA" & FIRST_TASK_ROW & ":AA" & LAST_TASK_ROW).WrapText = True

    ws.Rows(10).RowHeight = 36

    ' Buttons
    AddActionButton ws, "SEND REPORT", "SendReport", ws.Range("M2").Left, ws.Range("M2").Top, 110, 26
    AddActionButton ws, "CLEAR WEEK", "ClearWeek", ws.Range("O2").Left, ws.Range("O2").Top, 110, 26

    ' Freeze panes at first task row
    ws.Activate
    ws.Range("A" & FIRST_TASK_ROW).Select
    ActiveWindow.FreezePanes = True

    ' Print settings
    With ws.PageSetup
        .PrintArea = ws.Range("A1:AA" & LAST_TASK_ROW).Address
        .Orientation = xlLandscape
        .PaperSize = xlPaperLetter
        .Zoom = False
        .FitToPagesWide = 1
        .FitToPagesTall = False
        .LeftFooter = "Printed: &D &T"
        .CenterFooter = ThisWorkbook.Name
        .RightFooter = "Page &P of &N"
    End With
End Sub

Private Sub ApplyEntryConditionFormatting(ByVal ws As Worksheet, ByVal statusCol As String, ByVal findCol As String, ByVal actionCol As String)
    Dim rng As Range
    Set rng = ws.Range(findCol & FIRST_TASK_ROW & ":" & actionCol & LAST_TASK_ROW)

    rng.FormatConditions.Delete

    rng.FormatConditions.Add Type:=xlExpression, Formula1:="=$" & statusCol & FIRST_TASK_ROW & "=\"C\""
    rng.FormatConditions(rng.FormatConditions.Count).Interior.Color = RGB(217, 217, 217)

    rng.FormatConditions.Add Type:=xlExpression, Formula1:="=$" & statusCol & FIRST_TASK_ROW & "=\"NC\""
    rng.FormatConditions(rng.FormatConditions.Count).Interior.Color = RGB(255, 242, 204)
End Sub

Private Function BuildNCFormula(ByVal rowNum As Long) As String
    BuildNCFormula = "=COUNTIF(D" & rowNum & ",\"NC\")+COUNTIF(G" & rowNum & ",\"NC\")+COUNTIF(J" & rowNum & ",\"NC\")+COUNTIF(M" & rowNum & ",\"NC\")+COUNTIF(P" & rowNum & ",\"NC\")+COUNTIF(S" & rowNum & ",\"NC\")+COUNTIF(V" & rowNum & ",\"NC\")"
End Function

Private Function BuildComplianceFormula(ByVal rowNum As Long) As String
    Dim num As String, den As String
    num = "COUNTIF(D" & rowNum & ",\"C\")+COUNTIF(G" & rowNum & ",\"C\")+COUNTIF(J" & rowNum & ",\"C\")+COUNTIF(M" & rowNum & ",\"C\")+COUNTIF(P" & rowNum & ",\"C\")+COUNTIF(S" & rowNum & ",\"C\")+COUNTIF(V" & rowNum & ",\"C\")"
    den = num & "+COUNTIF(D" & rowNum & ",\"NC\")+COUNTIF(G" & rowNum & ",\"NC\")+COUNTIF(J" & rowNum & ",\"NC\")+COUNTIF(M" & rowNum & ",\"NC\")+COUNTIF(P" & rowNum & ",\"NC\")+COUNTIF(S" & rowNum & ",\"NC\")+COUNTIF(V" & rowNum & ",\"NC\")"
    BuildComplianceFormula = "=IF((" & den & ")=0,\"\"," & num & "/(" & den & "))"
End Function

Private Sub DrawSignatureBox(ByVal ws As Worksheet, ByVal topLeftCell As String, ByVal labelText As String)
    Dim shp As Shape
    Set shp = ws.Shapes.AddShape(msoShapeRectangle, ws.Range(topLeftCell).Left, ws.Range(topLeftCell).Top, 130, 24)
    shp.TextFrame2.TextRange.Characters.Text = labelText
    shp.Fill.ForeColor.RGB = RGB(255, 255, 255)
    shp.Line.ForeColor.RGB = RGB(127, 127, 127)
    shp.TextFrame2.TextRange.ParagraphFormat.Alignment = msoAlignCenter
    shp.TextFrame2.VerticalAnchor = msoAnchorMiddle
End Sub

Private Sub AddActionButton(ByVal ws As Worksheet, ByVal caption As String, ByVal macroName As String, _
                            ByVal leftPos As Double, ByVal topPos As Double, ByVal btnWidth As Double, ByVal btnHeight As Double)
    Dim btn As Button
    Set btn = ws.Buttons.Add(leftPos, topPos, btnWidth, btnHeight)
    btn.Caption = caption
    btn.Name = Replace(caption, " ", "") & "_" & ws.Index
    btn.OnAction = macroName
End Sub

Private Sub BuildDashboard(ByVal ws As Worksheet)
    ws.Cells.Clear
    ws.Cells.Font.Name = "Calibri"
    ws.Cells.Font.Size = 10

    ws.Range("A1").Value = "Sanitation Dashboard"
    ws.Range("A1").Font.Size = 16
    ws.Range("A1").Font.Bold = True

    ws.Range("A3").Value = "Shift 1 Overall Compliance %"
    ws.Range("A4").Value = "Shift 2 Overall Compliance %"
    ws.Range("A6").Value = "Shift 1 Total NC"
    ws.Range("A7").Value = "Shift 2 Total NC"

    ws.Range("B3").Formula = "=IFERROR(AVERAGE('Shift 1 - Weekly'!Z11:Z70),\"\")"
    ws.Range("B4").Formula = "=IFERROR(AVERAGE('Shift 2 - Weekly'!Z11:Z70),\"\")"
    ws.Range("B6").Formula = "=SUM('Shift 1 - Weekly'!Y11:Y70)"
    ws.Range("B7").Formula = "=SUM('Shift 2 - Weekly'!Y11:Y70)"

    ws.Range("B3:B4").NumberFormat = "0.0%"

    ws.Range("D3").Value = "Top 5 Areas with Most NCs - Shift 1"
    ws.Range("G3").Value = "Top 5 Areas with Most NCs - Shift 2"

    ws.Range("D4").Value = "Area/Task"
    ws.Range("E4").Value = "NC Count"
    ws.Range("G4").Value = "Area/Task"
    ws.Range("H4").Value = "NC Count"

    ws.Range("D5").Formula = "=IFERROR(TAKE(SORTBY(CHOOSE({1,2},'Shift 1 - Weekly'!B11:B70,'Shift 1 - Weekly'!Y11:Y70),'Shift 1 - Weekly'!Y11:Y70,-1),5),\"\")"
    ws.Range("G5").Formula = "=IFERROR(TAKE(SORTBY(CHOOSE({1,2},'Shift 2 - Weekly'!B11:B70,'Shift 2 - Weekly'!Y11:Y70),'Shift 2 - Weekly'!Y11:Y70,-1),5),\"\")"

    ws.Range("A10").Value = "Weekly Trend Placeholder"
    ws.Range("A11:C20").Interior.Color = RGB(242, 242, 242)
    ws.Range("A11").Value = "(Reserved area for chart)"

    With ws.Range("A3:H7")
        .Borders.LineStyle = xlContinuous
        .Borders.Weight = xlThin
    End With

    ws.Columns("A").ColumnWidth = 30
    ws.Columns("B").ColumnWidth = 16
    ws.Columns("D").ColumnWidth = 24
    ws.Columns("E").ColumnWidth = 12
    ws.Columns("G").ColumnWidth = 24
    ws.Columns("H").ColumnWidth = 12
End Sub

Private Sub BuildSettings(ByVal ws As Worksheet)
    ws.Cells.Clear
    ws.Cells.Font.Name = "Calibri"
    ws.Cells.Font.Size = 10

    ws.Range("A1").Value = "Email TO"
    ws.Range("B1").Value = "Email CC"
    ws.Range("C1").Value = "Default PDF Folder"
    ws.Range("D1").Value = "Default Department"

    ws.Range("D2").Value = "Food Catering Plant"

    ws.Columns("A:D").ColumnWidth = 35
End Sub

Public Function GetDefaultDepartment() As String
    On Error GoTo Fallback
    GetDefaultDepartment = Trim$(ThisWorkbook.Worksheets("Settings").Range("D2").Value)
    Exit Function
Fallback:
    GetDefaultDepartment = ""
End Function
```

---

### Module 2: `modReportActions`

```vba
Option Explicit

Public Sub SendReport()
    Dim ws As Worksheet
    Dim shiftNo As String
    Dim missing As Collection
    Dim htmlTable As String
    Dim subj As String, body As String
    Dim dep As String, wk As String, mon As String
    Dim overall As Double, ncTotal As Long
    Dim pdfPath As String
    Dim toList As String, ccList As String

    Set ws = ActiveSheet
    If ws.Name <> "Shift 1 - Weekly" And ws.Name <> "Shift 2 - Weekly" Then
        MsgBox "Please run SEND REPORT from a Shift weekly sheet.", vbExclamation
        Exit Sub
    End If

    shiftNo = IIf(ws.Name = "Shift 1 - Weekly", "1", "2")

    Set missing = New Collection
    ValidateNCEntries ws, missing

    If missing.Count > 0 Then
        ShowMissingFieldsMessage missing
        Exit Sub
    End If

    dep = Trim$(ws.Range("B2").Value)
    wk = Trim$(ws.Range("E2").Value)
    mon = Trim$(ws.Range("H2").Value)

    overall = GetOverallCompliance(ws)
    ncTotal = GetTotalNC(ws)

    htmlTable = BuildNCHtmlTable(ws)
    pdfPath = ExportShiftPDF(ws, shiftNo)

    subj = "Sanitation Weekly Performance Report - " & dep & " - " & mon & " " & wk & " - Shift " & shiftNo

    body = "<html><body style='font-family:Calibri;font-size:11pt;'>" & _
           "<p><b>Sanitation Weekly Performance Report</b></p>" & _
           "<p><b>Department:</b> " & HtmlEncode(dep) & "<br>" & _
           "<b>Shift:</b> " & shiftNo & "<br>" & _
           "<b>Period:</b> " & HtmlEncode(mon) & " " & HtmlEncode(wk) & "<br>" & _
           "<b>Overall Compliance:</b> " & Format(overall, "0.0%") & "<br>" & _
           "<b>Total NC Count:</b> " & ncTotal & "</p>" & _
           htmlTable & _
           "<p>Regards,<br>Sanitation Team</p>" & _
           "</body></html>"

    toList = GetRecipientList("A")
    ccList = GetRecipientList("B")

    CreateOutlookEmail subj, body, toList, ccList, pdfPath
End Sub

Public Sub ClearWeek()
    Dim ws As Worksheet
    If MsgBox("Are you sure you want to clear this week?", vbQuestion + vbYesNo, "Confirm") = vbNo Then Exit Sub

    Set ws = ActiveSheet
    If ws.Name <> "Shift 1 - Weekly" And ws.Name <> "Shift 2 - Weekly" Then
        MsgBox "Please run CLEAR WEEK from a Shift weekly sheet.", vbExclamation
        Exit Sub
    End If

    ws.Range("D11:X70").ClearContents
    ws.Range("AA11:AA70").ClearContents

    MsgBox "Week data cleared.", vbInformation
End Sub

Public Sub ValidateNCEntries(ByVal ws As Worksheet, ByRef missing As Collection)
    Dim r As Long, i As Long
    Dim areaName As String
    Dim statusCols As Variant, findCols As Variant, actionCols As Variant, dayNames As Variant
    Dim statusVal As String, findVal As String, actionVal As String

    statusCols = Array("D", "G", "J", "M", "P", "S", "V")
    findCols = Array("E", "H", "K", "N", "Q", "T", "W")
    actionCols = Array("F", "I", "L", "O", "R", "U", "X")
    dayNames = Array("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

    For r = 11 To 70
        areaName = Trim$(ws.Cells(r, "B").Value)
        If areaName <> "" Then
            For i = LBound(statusCols) To UBound(statusCols)
                statusVal = UCase$(Trim$(ws.Cells(r, statusCols(i)).Value))
                If statusVal = "NC" Then
                    findVal = Trim$(ws.Cells(r, findCols(i)).Value)
                    actionVal = Trim$(ws.Cells(r, actionCols(i)).Value)
                    If findVal = "" Or actionVal = "" Then
                        missing.Add areaName & " - " & dayNames(i)
                    End If
                End If
            Next i
        End If
    Next r
End Sub

Private Sub ShowMissingFieldsMessage(ByVal missing As Collection)
    Dim msg As String, i As Long, maxShow As Long
    maxShow = WorksheetFunction.Min(10, missing.Count)

    msg = "Validation failed. Missing Findings and/or Corrective Action for NC entries:" & vbCrLf & vbCrLf
    For i = 1 To maxShow
        msg = msg & i & ". " & missing(i) & vbCrLf
    Next i

    If missing.Count > maxShow Then
        msg = msg & "... and " & (missing.Count - maxShow) & " more."
    End If

    MsgBox msg, vbExclamation, "Incomplete NC Records"
End Sub

Public Function BuildNCHtmlTable(ByVal ws As Worksheet) As String
    Dim r As Long, i As Long
    Dim statusCols As Variant, findCols As Variant, actionCols As Variant, dayNames As Variant
    Dim areaName As String, statusVal As String
    Dim html As String

    statusCols = Array("D", "G", "J", "M", "P", "S", "V")
    findCols = Array("E", "H", "K", "N", "Q", "T", "W")
    actionCols = Array("F", "I", "L", "O", "R", "U", "X")
    dayNames = Array("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

    html = "<table border='1' cellspacing='0' cellpadding='5' style='border-collapse:collapse;font-family:Calibri;font-size:10pt;'>" & _
           "<tr style='background-color:#1F4E78;color:#FFFFFF;font-weight:bold;'><td>Area/Task</td><td>Day</td><td>Finding</td><td>Corrective Action</td></tr>"

    For r = 11 To 70
        areaName = Trim$(ws.Cells(r, "B").Value)
        If areaName <> "" Then
            For i = LBound(statusCols) To UBound(statusCols)
                statusVal = UCase$(Trim$(ws.Cells(r, statusCols(i)).Value))
                If statusVal = "NC" Then
                    html = html & "<tr><td>" & HtmlEncode(areaName) & "</td><td>" & dayNames(i) & "</td><td>" & _
                           HtmlEncode(ws.Cells(r, findCols(i)).Value) & "</td><td>" & _
                           HtmlEncode(ws.Cells(r, actionCols(i)).Value) & "</td></tr>"
                End If
            Next i
        End If
    Next r

    html = html & "</table>"
    BuildNCHtmlTable = html
End Function

Public Function ExportShiftPDF(ByVal ws As Worksheet, ByVal shiftNo As String) As String
    Dim folderPath As String, fileName As String
    Dim dep As String, mon As String, wk As String

    dep = SafeFileText(Trim$(ws.Range("B2").Value))
    mon = SafeFileText(Trim$(ws.Range("H2").Value))
    wk = Replace(Trim$(ws.Range("E2").Value), "Week ", "")

    folderPath = Trim$(ThisWorkbook.Worksheets("Settings").Range("C2").Value)
    If folderPath = "" Then folderPath = ThisWorkbook.Path
    If Right$(folderPath, 1) <> "\" Then folderPath = folderPath & "\"

    fileName = "Sanitation_Report_" & dep & "_" & mon & "_Week" & wk & "_Shift" & shiftNo & ".pdf"
    ExportShiftPDF = folderPath & fileName

    ws.ExportAsFixedFormat Type:=xlTypePDF, Filename:=ExportShiftPDF, Quality:=xlQualityStandard, _
                           IncludeDocProperties:=True, IgnorePrintAreas:=False, OpenAfterPublish:=False
End Function

Public Sub CreateOutlookEmail(ByVal mailSubject As String, ByVal htmlBody As String, _
                              ByVal toList As String, ByVal ccList As String, ByVal pdfPath As String)
    Dim olApp As Object, olMail As Object

    On Error Resume Next
    Set olApp = GetObject(, "Outlook.Application")
    If olApp Is Nothing Then Set olApp = CreateObject("Outlook.Application")
    On Error GoTo 0

    If olApp Is Nothing Then
        MsgBox "Microsoft Outlook is not installed or could not be opened.", vbCritical
        Exit Sub
    End If

    Set olMail = olApp.CreateItem(0)

    With olMail
        .To = toList
        .CC = ccList
        .Subject = mailSubject
        .HTMLBody = htmlBody
        If Len(Dir$(pdfPath)) > 0 Then
            .Attachments.Add pdfPath
        End If
        .Display   ' important: do NOT auto-send
    End With
End Sub

Public Function GetRecipientList(ByVal colLetter As String) As String
    Dim ws As Worksheet
    Dim lastRow As Long, r As Long
    Dim s As String, v As String

    Set ws = ThisWorkbook.Worksheets("Settings")
    lastRow = ws.Cells(ws.Rows.Count, colLetter).End(xlUp).Row

    For r = 2 To lastRow
        v = Trim$(ws.Cells(r, colLetter).Value)
        If v <> "" Then
            If s <> "" Then s = s & ";"
            s = s & v
        End If
    Next r

    GetRecipientList = s
End Function

Public Function GetTotalNC(ByVal ws As Worksheet) As Long
    GetTotalNC = WorksheetFunction.Sum(ws.Range("Y11:Y70"))
End Function

Public Function GetOverallCompliance(ByVal ws As Worksheet) As Double
    Dim r As Long
    Dim denom As Long, c As Long, nc As Long
    Dim statusCols As Variant
    Dim totalRatio As Double, countRows As Long

    statusCols = Array("D", "G", "J", "M", "P", "S", "V")

    For r = 11 To 70
        If Trim$(ws.Cells(r, "B").Value) <> "" Then
            c = CountStatusInRow(ws, r, statusCols, "C")
            nc = CountStatusInRow(ws, r, statusCols, "NC")
            denom = c + nc
            If denom > 0 Then
                totalRatio = totalRatio + (c / denom)
                countRows = countRows + 1
            End If
        End If
    Next r

    If countRows = 0 Then
        GetOverallCompliance = 0
    Else
        GetOverallCompliance = totalRatio / countRows
    End If
End Function

Private Function CountStatusInRow(ByVal ws As Worksheet, ByVal rowNum As Long, ByVal statusCols As Variant, ByVal targetStatus As String) As Long
    Dim i As Long, v As String
    For i = LBound(statusCols) To UBound(statusCols)
        v = UCase$(Trim$(ws.Cells(rowNum, statusCols(i)).Value))
        If v = targetStatus Then CountStatusInRow = CountStatusInRow + 1
    Next i
End Function

Private Function SafeFileText(ByVal txt As String) As String
    Dim badChars As Variant, i As Long
    badChars = Array("\\", "/", ":", "*", "?", "\"""", "<", ">", "|")
    SafeFileText = txt
    For i = LBound(badChars) To UBound(badChars)
        SafeFileText = Replace(SafeFileText, badChars(i), "_")
    Next i
    If SafeFileText = "" Then SafeFileText = "NA"
End Function

Public Function HtmlEncode(ByVal txt As String) As String
    Dim s As String
    s = CStr(txt)
    s = Replace(s, "&", "&amp;")
    s = Replace(s, "<", "&lt;")
    s = Replace(s, ">", "&gt;")
    s = Replace(s, "\"", "&quot;")
    HtmlEncode = Replace(s, vbCrLf, "<br>")
End Function
```

---

## 2) Exact Instructions: Where to Paste Code in VBA Editor

1. Open Excel and create a new workbook.
2. Save as **`Sanitation_Team_Performance_Program.xlsm`** (macro-enabled).
3. Press **`ALT + F11`** to open VBA editor.
4. In the Project pane, right-click your workbook → **Insert → Module**.
5. Rename this module to **`modProgramSetup`** and paste the entire **Module 1** code.
6. Insert another module and rename it to **`modReportActions`**.
7. Paste the entire **Module 2** code.
8. Press **`CTRL + S`** to save VBA.
9. In VBA editor, press `F5` while cursor is inside `BuildSanitationProgramWorkbook`.
10. Return to Excel: the required sheets, formatting, formulas, and buttons will be created.

---

## 3) Exact Steps to Create Buttons and Assign Macros

> If you run `BuildSanitationProgramWorkbook`, buttons are auto-created and assigned.
> If you want to do it manually, use these exact steps:

1. Go to **Shift 1 - Weekly** sheet.
2. Enable Developer tab (if hidden): File → Options → Customize Ribbon → check **Developer**.
3. Developer → **Insert** → **Button (Form Control)**.
4. Draw first button near top row.
5. Assign macro: **`SendReport`**.
6. Right-click button → Edit Text → set to **`SEND REPORT`**.
7. Insert second button similarly and assign **`ClearWeek`**.
8. Edit text to **`CLEAR WEEK`**.
9. Repeat on **Shift 2 - Weekly**.

---

## 4) Quick Test Checklist (5 Steps)

1. Run **`BuildSanitationProgramWorkbook`** and confirm sheets exist:
   - Shift 1 - Weekly
   - Shift 2 - Weekly
   - Dashboard
   - Settings (hidden)
2. On Shift 1, set one row with `NC` on Monday but leave Findings/Corrective Action blank, click **SEND REPORT**, verify validation message appears.
3. Fill required Findings and Corrective Action for that NC, click **SEND REPORT**, verify Outlook draft opens (not auto-sent) and PDF is attached.
4. Confirm NC/C colors and Compliance % threshold colors apply correctly (NC red, C green; <95% red text).
5. Click **CLEAR WEEK**, confirm only daily entries/findings/actions/comments are cleared; header fields remain.

---

## Notes
- This solution is designed for **Windows Excel + Outlook desktop**.
- If Outlook is missing, user receives a clear error message.
- Recipients are read from hidden **Settings** sheet:
  - To list: column A starting A2
  - CC list: column B starting B2
  - Optional default PDF folder: C2
  - Optional default department: D2
