import { Component, ViewChild, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgApexchartsModule, ChartComponent } from "ng-apexcharts";
import { QualityService } from './quality.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-quality',
  standalone: true,
  imports: [CommonModule, FormsModule, NgApexchartsModule],
  templateUrl: './quality.html',
  styleUrl: './quality.scss'
})
export class Quality implements OnInit {

  @ViewChild("chart") chart!: ChartComponent;

  lines: any[] = [];
  machines: any[] = [];
  shifts: any[] = [];

  selectedLine!: number;
  selectedMachine!: number;
  selectedShift!: number;

  today = new Date().toISOString().split('T')[0];
  selectedDate!: string;

  dashboardData: any = null;

  // Editable fields
  rejectedValue: number = 0;
  reworkValue: number = 0;
  editingRejected = false;
  editingRework = false;
  private rejectedSnapshot = 0;
  private reworkSnapshot = 0;

  public hourPerformOptions: any = {
    series: [],
    chart: {
      type: "area",
      height: 250,
      toolbar: { show: false }
    },
    stroke: { curve: "smooth", width: 3 },
    dataLabels: { enabled: false },
    xaxis: { categories: [] }
  };

  constructor(private service: QualityService,
    private cdr: ChangeDetectorRef,
    public  auth: AuthService
  ) { }

  ngOnInit() {
    const today = new Date().toISOString().split('T')[0];
    this.selectedDate = today;

    this.loadInitialData();

  }

  ////////////////////////////////////////////////////
  // INITIAL LOAD FLOW
  ////////////////////////////////////////////////////

  loadInitialData() {
    this.service.getLines().subscribe(res => {
      this.lines = res.data;

      if (this.lines.length > 0) {
        this.selectedLine = this.lines[0].id;

        this.loadMachinesAndContinue();
      }
      this.cdr.detectChanges();

    });
  }

  loadMachinesAndContinue() {
    this.service.getMachinesByLine(this.selectedLine).subscribe(res => {
      this.machines = res.data;

      if (this.machines.length > 0) {
        this.selectedMachine = this.machines[0].id;

        this.loadShiftsAndContinue();
      }
      this.cdr.detectChanges();

    });
  }

  loadShiftsAndContinue() {
    this.service.getShifts().subscribe(res => {
      this.shifts = res.data;

      if (this.shifts.length > 0) {
        this.selectedShift = this.shifts[0].id;

        // Finally call dashboard
        this.loadDashboard();
      }
      this.cdr.detectChanges();

    });
  }

  ////////////////////////////////////////////////////
  // MANUAL SUBMIT
  ////////////////////////////////////////////////////

  submit() {
    this.loadDashboard();
  }

  ////////////////////////////////////////////////////
  // DASHBOARD API
  ////////////////////////////////////////////////////

  loadDashboard() {

    if (!this.selectedMachine || !this.selectedShift || !this.selectedDate) return;

    this.service.getDashboard({
      machine_id: this.selectedMachine,
      shift_id: this.selectedShift,
      date: this.selectedDate
    }).subscribe(res => {

      if (!res.success) return;

      this.dashboardData = res.data;

      this.rejectedValue = res.data.production?.reject ?? 0;
      this.reworkValue = res.data.production?.rework ?? 0;

      this.updateChart(res.data.hourly || []);
      this.cdr.detectChanges();

    });
  }

  ////////////////////////////////////////////////////
  // CHART UPDATE
  ////////////////////////////////////////////////////

  ////////////////////////////////////////////////////
  // REJECTED / REWORK EDITING
  ////////////////////////////////////////////////////

  startEditRejected() {
    this.rejectedSnapshot = this.rejectedValue;
    this.editingRejected = true;
  }

  saveRejected() {
    this.editingRejected = false;
    this.saveQuality();
  }

  cancelRejected() {
    this.rejectedValue = this.rejectedSnapshot;
    this.editingRejected = false;
  }

  startEditRework() {
    this.reworkSnapshot = this.reworkValue;
    this.editingRework = true;
  }

  saveRework() {
    this.editingRework = false;
    this.saveQuality();
  }

  cancelRework() {
    this.reworkValue = this.reworkSnapshot;
    this.editingRework = false;
  }

  private saveQuality() {
    this.service.saveQuality({
      machine_id: this.selectedMachine,
      shift_id: this.selectedShift,
      date: this.selectedDate,
      reject_qty: this.rejectedValue,
      rework_qty: this.reworkValue
    }).subscribe(res => {
      if (res?.success) {
        this.loadDashboard();
      }
    });
  }

  ////////////////////////////////////////////////////
  // CHART UPDATE
  ////////////////////////////////////////////////////

  updateChart(hourly: any[]) {

    const categories = hourly.map(h =>
      new Date(h.hour)
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );

    this.hourPerformOptions.series = [
      { name: "OEE", data: hourly.map(h => Number(h.oee)) },
      { name: "Availability", data: hourly.map(h => Number(h.availability)) },
      { name: "Performance", data: hourly.map(h => Number(h.performance)) },
      { name: "Quality", data: hourly.map(h => Number(h.quality)) }
    ];

    this.hourPerformOptions.xaxis = { categories };
  }

  ////////////////////////////////////////////////////
  // WHEN LINE CHANGED MANUALLY
  ////////////////////////////////////////////////////

  onLineChange() {
    this.service.getMachines(this.selectedLine).subscribe(res => {
      this.machines = res.data || [];
      this.selectedMachine = this.machines[0]?.id;

      if (this.selectedMachine) {
        this.loadDashboard();
      } else {
        this.dashboardData = null;
        this.cdr.detectChanges();
      }
    });
  }
}