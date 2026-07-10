' Trace.vbs - lanceur : demarre le serveur local (cache) si besoin, puis ouvre la fenetre Trace.
' Strings ASCII uniquement (encodage VBS).
Option Explicit
Dim shell, fso, i, EDGE, URL
URL = "http://127.0.0.1:47621"
EDGE = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

Function Ping()
  On Error Resume Next
  Dim h
  Set h = CreateObject("MSXML2.XMLHTTP")
  h.open "GET", URL & "/api/ping", False
  h.send
  Ping = (Err.Number = 0)
  If Ping Then Ping = (h.status = 200)
  On Error GoTo 0
End Function

If Not Ping() Then
  shell.CurrentDirectory = "D:\trace"
  shell.Run "cmd /c node server.js", 0, False
  For i = 1 To 40
    WScript.Sleep 250
    If Ping() Then Exit For
  Next
End If

If Not Ping() Then
  MsgBox "Le serveur Trace n'a pas demarre. Verifie que Node.js est installe.", 48, "Trace"
  WScript.Quit 1
End If

If fso.FileExists(EDGE) Then
  shell.Run """" & EDGE & """ --app=" & URL & "/", 1, False
Else
  shell.Run URL & "/", 1, False
End If
