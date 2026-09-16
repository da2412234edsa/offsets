Attribute VB_Name = "mod_CreateForms"
Option Compare Database
Option Explicit

'============================================================
' Run CreateAllForms once in Access (press F5 or from Immediate:
'   Call CreateAllForms
' ) to build the two required data-entry forms.
'============================================================
Public Sub CreateAllForms()
    On Error GoTo ErrHandler

    If FormExists("frm_Student_Entry") Then DoCmd.DeleteObject acForm, "frm_Student_Entry"
    If FormExists("tbl_Club_Registrations_Subform") Then DoCmd.DeleteObject acForm, "tbl_Club_Registrations_Subform"
    If FormExists("frm_Club_Registrations_Master") Then DoCmd.DeleteObject acForm, "frm_Club_Registrations_Master"

    CreateStudentEntryForm
    CreateRegistrationsSubform
    CreateRegistrationsMasterForm

    MsgBox "Forms created successfully:" & vbCrLf & _
           "• frm_Student_Entry" & vbCrLf & _
           "• frm_Club_Registrations_Master" & vbCrLf & _
           "• tbl_Club_Registrations_Subform", _
           vbInformation, "School Extracurricular Clubs"
    Exit Sub

ErrHandler:
    MsgBox "Error " & Err.Number & ": " & Err.Description, vbCritical
End Sub

Private Function FormExists(ByVal formName As String) As Boolean
    Dim obj As AccessObject
    For Each obj In CurrentProject.AllForms
        If StrComp(obj.Name, formName, vbTextCompare) = 0 Then
            FormExists = True
            Exit Function
        End If
    Next
    FormExists = False
End Function

Private Sub CreateStudentEntryForm()
    Dim frm As Form
    Dim tempName As String
    Dim top As Long

    Set frm = CreateForm()
    tempName = frm.Name
    frm.RecordSource = "tbl_Students_Master"
    frm.Caption = "Student Entry"
    frm.DefaultView = 0 ' Single Form
    frm.AutoCenter = True
    frm.BorderStyle = 3

    top = 200
    AddBoundTextBox frm, "StudentID", "Student ID", top: top = top + 500
    AddBoundTextBox frm, "FirstName", "First Name", top: top = top + 500
    AddBoundTextBox frm, "LastName", "Last Name", top: top = top + 500
    AddBoundTextBox frm, "YearGroup", "Year Group", top: top = top + 500
    AddBoundTextBox frm, "EmergencyContact", "Emergency Contact", top

    DoCmd.Close acForm, tempName, acSaveYes
    DoCmd.Rename "frm_Student_Entry", acForm, tempName
End Sub

Private Sub CreateRegistrationsSubform()
    Dim frm As Form
    Dim tempName As String

    Set frm = CreateForm()
    tempName = frm.Name
    frm.RecordSource = "tbl_Club_Registrations"
    frm.Caption = "Club Registrations"
    frm.DefaultView = 2 ' Datasheet
    frm.NavigationButtons = True

    AddBoundTextBox frm, "RegistrationID", "Registration ID", 200
    AddBoundTextBox frm, "ClubID", "Club ID", 700
    AddBoundTextBox frm, "RegistrationDate", "Registration Date", 1200

    DoCmd.Close acForm, tempName, acSaveYes
    DoCmd.Rename "tbl_Club_Registrations_Subform", acForm, tempName
End Sub

Private Sub CreateRegistrationsMasterForm()
    Dim frm As Form
    Dim ctl As Control
    Dim tempName As String
    Dim top As Long

    Set frm = CreateForm()
    tempName = frm.Name
    frm.RecordSource = "tbl_Students_Master"
    frm.Caption = "Club Registrations Master"
    frm.DefaultView = 0
    frm.AutoCenter = True

    top = 200
    AddBoundTextBox frm, "StudentID", "Student ID", top: top = top + 500
    AddBoundTextBox frm, "FirstName", "First Name", top: top = top + 500
    AddBoundTextBox frm, "LastName", "Last Name", top: top = top + 500
    AddBoundTextBox frm, "YearGroup", "Year Group", top: top = top + 700

    Set ctl = CreateControl(tempName, acSubform, acDetail, , , 200, top, 9000, 3500)
    ctl.Name = "sfrm_Club_Registrations"
    ctl.SourceObject = "Form.tbl_Club_Registrations_Subform"
    ctl.LinkMasterFields = "StudentID"
    ctl.LinkChildFields = "StudentID"

    DoCmd.Close acForm, tempName, acSaveYes
    DoCmd.Rename "frm_Club_Registrations_Master", acForm, tempName
End Sub

Private Sub AddBoundTextBox(ByVal frm As Form, ByVal fieldName As String, _
                             ByVal caption As String, ByVal top As Long)
    Dim lbl As Control
    Dim txt As Control

    Set lbl = CreateControl(frm.Name, acLabel, acDetail, , , 200, top, 2200, 340)
    lbl.Name = "lbl_" & fieldName
    lbl.Caption = caption

    Set txt = CreateControl(frm.Name, acTextBox, acDetail, , fieldName, 2600, top, 3500, 340)
    txt.Name = "txt_" & fieldName
    txt.ControlSource = fieldName
End Sub
