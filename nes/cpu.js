var NES = NES || {};

// Callbacks, object with:
//		ReadByte: function(Address).
//		WriteByte: function(Address, Value).
//		RaiseInterrupt: function(InterruptType).
NES.CPU = function(Callbacks)
{
	var Self = this;
	var PC; // Program counter.
	var S; // Stack pointer.
	var A; // Accumulator.
	var X; // X register.
	var Y; // Y register.
	// The below flags all belong to the processor status (P) register.
	var Carry;
	var Zero;
	var IRQDisable;
	var DecimalMode;
	var Break;
	var Overflow;
	var Negative;

	// Start-up values according to http://wiki.nesdev.com/w/index.php/CPU_power_up_state
	S = 0xFD;
	A = X = Y = 0;
	Carry = Zero = DecimalMode = Break = Overflow = Negative = false;
	IRQDisable = true;
	Self.PC = function(NewPC) { if (NewPC) PC = NewPC; else return PC; };

	var ReadByte = Callbacks.ReadByte;
	var WriteByte = Callbacks.WriteByte;

	Self.Details = function()
	{
		var Details = {};
		Details.PC = PC;
		Details.A = A;
		Details.X = X;
		Details.Y = Y;
		Details.S = StatusRegister();
		return Details;
	};

	// Pretty-print the 10 instructions starting from PC.
	Self.Disassemble = function()
	{
		var TempPC = PC;

		var Output = [];
		while (Output.length < 10)
		{
			var Instruction = { "PC": TempPC };
			var Opcode = Opcodes[ReadByte(TempPC)] || {};
			TempPC++;

			Instruction.Text = (Opcode.Instruction || {}).name || "???";

			var Argument;
			switch (Opcode.AddressingMode.name)
			{
				case "Immediate":
				case "Relative":
				case "ZeroPage":
				case "ZeroPageX":
				case "ZeroPageY":
				case "IndirectIndexed":
				case "IndirectIndexed_RW":
				case "IndexedIndirect":
					Argument = ("00" + ReadByte(TempPC).toString(16)).substr(-2, 2);
					TempPC++;
					break;

				case "Absolute":
				case "AbsoluteX":
				case "AbsoluteY":
				case "AbsoluteX_RW":
				case "AbsoluteY_RW":
				case "Indirect":
					var Low = ReadByte(TempPC);
					var High = ReadByte(TempPC + 1);
					Argument = ("0000" + ((High << 8) | Low).toString(16)).substr(-4, 4);
					TempPC += 2;
					break;

				default:
					break;
			}

			switch (Opcode.AddressingMode.name)
			{
				case "Immediate":
				case "Absolute":
				case "Relative":
				case "ZeroPage":
					Instruction.Text += " $" + Argument;
					break;

				case "AbsoluteX":
				case "AbsoluteX_RW":
				case "ZeroPageX":
					Instruction.Text += " $" + Argument + ", X";
					break;

				case "AbsoluteY":
				case "AbsoluteY_RW":
				case "ZeroPageY":
					Instruction.Text += " $" + Argument + ", Y";
					break;

				case "IndirectIndexed":
				case "IndirectIndexed_RW":
					Instruction.Text += " ($" + Argument + "), Y";
					break;

				case "IndexedIndirect":
					Instruction.Text += " ($" + Argument + ", X)";
					break;

				case "Indirect":
					Instruction.Text + " ($" + Argument + ")";
					break;
			}

			Output.push(Instruction);
		}

		return Output;
	};

	Self.Step = function()
	{
		// Fetch the next opcode.
		var OpcodeIndex = ReadByte(PC);
		CurrentOpcode = Opcodes[OpcodeIndex];
		if (!CurrentOpcode) throw "Opcode $" + OpcodeIndex.ToString(16) + " not implemented.";

		// Execute the addressing mode preparation.
		CurrentOpcode.AddressingMode();
		if (CurrentOpcode.NeedsReadFromMemory) TempM = ReadByte(TempAddress);
		CurrentOpcode.Instruction();
	}

	function StatusRegister()
	{
		return (0x20 | (Carry ? 0x01 : 0) | (Zero ? 0x02 : 0) | (IRQDisable ? 0x04 : 0) | (DecimalMode ? 0x08 : 0) | (Overflow ? 0x40 : 0) | (Negative ? 0x80 : 0));
	}

	function PushStack(Value)
	{
		WriteByte(NES.StackAddress + S, Value);
		--S;
		S &= 0xFF;
	}

	function PopStack()
	{
		var M = ReadByte(NES.StackAddress + ((S + 1) & 0xFF));
		++S;
		S &= 0xFF;
		return M;
	}























	// Define all the opcodes. TODO: refactor this to be somewhere else.
	var Opcodes = [];
	for (var i = 0; i < 256; i++) Opcodes.push({ "AddressingMode": null, "Instruction": null });

	function SetAddressingMode(Mode, List)
	{
		List.forEach(function(N) { Opcodes[N].AddressingMode = Mode; });
	}

	SetAddressingMode(Immediate, [ 0x09, 0x29, 0x49, 0x69, 0xA0, 0xA2, 0xA9, 0xC0, 0xC9, 0xE0, 0xE9 ]);
	SetAddressingMode(Absolute, [ 0x0D, 0x0E, 0x20, 0x2C, 0x2D, 0x2E, 0x4C, 0x4D, 0x4E, 0x6D, 0x6E, 0x8C, 0x8D, 0x8E, 0xAC, 0xAD, 0xAE, 0xCC, 0xCD, 0xCE, 0xEC, 0xED, 0xEE ]);
	SetAddressingMode(AbsoluteX, [ 0x1D, 0x3D, 0x5D, 0x7D, 0xBC, 0xBD, 0xDD, 0xFD ]);
	SetAddressingMode(AbsoluteX_RW, [ 0x1E, 0x3E, 0x5E, 0xDE, 0xFE, 0x7E, 0x9D ]);
	SetAddressingMode(AbsoluteY, [ 0x19, 0x39, 0x59, 0x79, 0xB9, 0xD9, 0xF9, 0xBE ]);
	SetAddressingMode(AbsoluteY_RW, [ 0x99 ]);
	SetAddressingMode(Relative, [ 0x10, 0x30, 0x50, 0x70, 0x90, 0xB0, 0xD0, 0xF0 ]);
	SetAddressingMode(Implied, [ 0x08, 0x18, 0x28, 0x38, 0x40, 0x48, 0x58, 0x60, 0x68, 0x78, 0x88, 0x8A, 0x98, 0x9A, 0xA8, 0xAA, 0xB8, 0xBA, 0xC8, 0xCA, 0xD8, 0xE8, 0xEA, 0xF8, 0x0A, 0x2A, 0x4A, 0x6A ]);
	SetAddressingMode(ZeroPage, [ 0x05, 0x06, 0x24, 0x25, 0x26, 0x45, 0x46, 0x65, 0x66, 0x84, 0x85, 0x86, 0xA4, 0xA5, 0xA6, 0xC4, 0xC5, 0xC6, 0xE4, 0xE5, 0xE6 ]);
	SetAddressingMode(ZeroPageX, [ 0x15, 0x16, 0x35, 0x36, 0x55, 0x56, 0x75, 0x76, 0x94, 0x95, 0xB4, 0xB5, 0xD5, 0xD6, 0xF5, 0xF6 ]);
	SetAddressingMode(ZeroPageY, [ 0x96, 0xB6 ]);
	SetAddressingMode(IndirectIndexed, [ 0x11, 0x31, 0x51, 0x71, 0xB1, 0xD1, 0xF1 ]);
	SetAddressingMode(IndirectIndexed_RW, [ 0x91 ]);
	SetAddressingMode(IndexedIndirect, [ 0x01, 0x21, 0x41, 0x61, 0x81, 0xA1, 0xC1, 0xE1 ]);
	SetAddressingMode(Indirect, [ 0x6C ]);

	function SetInstruction(Instruction, List)
	{
		List.forEach(function(N) { Opcodes[N].Instruction = Instruction; });
	}

	function SetReadFromMemory(List)
	{
		List.forEach(function(N) { Opcodes[N].NeedsReadFromMemory = true; });
	}

	SetInstruction(ADC, [ 0x61, 0x65, 0x69, 0x6D, 0x71, 0x75, 0x79, 0x7D ]);
	SetReadFromMemory([ 0x61, 0x65, 0x6D, 0x71, 0x75, 0x79, 0x7D ]);
	SetInstruction(AND, [ 0x21, 0x25, 0x29, 0x2D, 0x31, 0x35, 0x39, 0x3D ]);
	SetReadFromMemory([ 0x21, 0x25, 0x2D, 0x31, 0x35, 0x39, 0x3D ]);
	SetInstruction(ASL, [ 0x06, 0x0E, 0x16, 0x1E ]);
	SetReadFromMemory([ 0x06, 0x0E, 0x16, 0x1E ]);
	SetInstruction(ASL_A, [ 0x0A ]);
	SetInstruction(BIT, [ 0x24, 0x2C ]);
	SetReadFromMemory([ 0x24, 0x2C ]);
	SetInstruction(CMP, [ 0xC1, 0xC5, 0xC9, 0xCD, 0xD1, 0xD5, 0xD9, 0xDD ]);
	SetReadFromMemory([ 0xC1, 0xC5, 0xCD, 0xD1, 0xD5, 0xD9, 0xDD ]);
	SetInstruction(CPX, [ 0xE0, 0xE4, 0xEC ]);
	SetReadFromMemory([ 0xE4, 0xEC ]);
	SetInstruction(CPY, [ 0xC0, 0xC4, 0xCC ]);
	SetReadFromMemory([ 0xC4, 0xCC ]);
	SetInstruction(DEC, [ 0xC6, 0xCE, 0xD6, 0xDE ]);
	SetReadFromMemory([ 0xC6, 0xCE, 0xD6, 0xDE ]);
	SetInstruction(EOR, [ 0x41, 0x45, 0x49, 0x4D, 0x51, 0x55, 0x59, 0x5D ]);
	SetReadFromMemory([ 0x41, 0x45, 0x4D, 0x51, 0x55, 0x59, 0x5D ]);
	SetInstruction(INC, [ 0xE6, 0xEE, 0xF6, 0xFE ]);
	SetReadFromMemory([ 0xE6, 0xEE, 0xF6, 0xFE ]);
	SetInstruction(JMP, [ 0x4C, 0x6C ]);
	SetInstruction(LDA, [ 0xA1, 0xA5, 0xA9, 0xAD, 0xB1, 0xB5, 0xB9, 0xBD ]);
	SetReadFromMemory([ 0xA1, 0xA5, 0xAD, 0xB1, 0xB5, 0xB9, 0xBD ]);
	SetInstruction(LDX, [ 0xA2, 0xA6, 0xAE, 0xB6, 0xBE ]);
	SetReadFromMemory([ 0xA6, 0xAE, 0xB6, 0xBE ]);
	SetInstruction(LDY, [ 0xA0, 0xA4, 0xAC, 0xB4, 0xBC ]);
	SetReadFromMemory([ 0xA4, 0xAC, 0xB4, 0xBC ]);
	SetInstruction(LSR, [ 0x46, 0x4E, 0x56, 0x5E ]);
	SetReadFromMemory([ 0x46, 0x4E, 0x56, 0x5E ]);
	SetInstruction(LSR_A, [ 0x4A ]);
	SetInstruction(ORA, [ 0x01, 0x05, 0x09, 0x0D, 0x11, 0x15, 0x19, 0x1D ]);
	SetReadFromMemory([ 0x01, 0x05, 0x0D, 0x11, 0x15, 0x19, 0x1D ]);
	SetInstruction(ROL, [ 0x26, 0x2E, 0x36, 0x3E ]);
	SetReadFromMemory([ 0x26, 0x2E, 0x36, 0x3E ]);
	SetInstruction(ROL_A, [ 0x2A ]);
	SetInstruction(ROR, [ 0x66, 0x6E, 0x76, 0x7E ]);
	SetReadFromMemory([ 0x66, 0x6E, 0x76, 0x7E ]);
	SetInstruction(ROR_A, [ 0x6A ]);
	SetInstruction(SBC, [ 0xE1, 0xE5, 0xE9, 0xED, 0xF1, 0xF5, 0xF9, 0xFD ]);
	SetReadFromMemory([ 0xE1, 0xE5, 0xED, 0xF1, 0xF5, 0xF9, 0xFD ]);
	SetInstruction(STA, [ 0x81, 0x85, 0x8D, 0x91, 0x95, 0x99, 0x9D ]);
	SetInstruction(STX, [ 0x86, 0x8E, 0x96 ]);
	SetInstruction(STY, [ 0x84, 0x8C, 0x94 ]);
	SetInstruction(BCC, [ 0x90 ]);
	SetInstruction(BCS, [ 0xB0 ]);
	SetInstruction(BEQ, [ 0xF0 ]);
	SetInstruction(BMI, [ 0x30 ]);
	SetInstruction(BNE, [ 0xD0 ]);
	SetInstruction(BPL, [ 0x10 ]);
	SetInstruction(BVC, [ 0x50 ]);
	SetInstruction(BVS, [ 0x70 ]);
	SetInstruction(CLC, [ 0x18 ]);
	SetInstruction(CLD, [ 0xD8 ]);
	SetInstruction(CLI, [ 0x58 ]);
	SetInstruction(CLV, [ 0xB8 ]);
	SetInstruction(DEX, [ 0xCA ]);
	SetInstruction(DEY, [ 0x88 ]);
	SetInstruction(INX, [ 0xE8 ]);
	SetInstruction(INY, [ 0xC8 ]);
	SetInstruction(JSR, [ 0x20 ]);
	SetInstruction(NOP, [ 0xEA ]);
	SetInstruction(PHA, [ 0x48 ]);
	SetInstruction(PHP, [ 0x08 ]);
	SetInstruction(PLA, [ 0x68 ]);
	SetInstruction(PLP, [ 0x28 ]);
	SetInstruction(RTI, [ 0x40 ]);
	SetInstruction(RTS, [ 0x60 ]);
	SetInstruction(SEC, [ 0x38 ]);
	SetInstruction(SED, [ 0xF8 ]);
	SetInstruction(SEI, [ 0x78 ]);
	SetInstruction(TAX, [ 0xAA ]);
	SetInstruction(TAY, [ 0xA8 ]);
	SetInstruction(TSX, [ 0xBA ]);
	SetInstruction(TXA, [ 0x8A ]);
	SetInstruction(TXS, [ 0x9A ]);
	SetInstruction(TYA, [ 0x98 ]);

	// BRK totally anomalous. Needs to execute its interrupt without worrying about next instruction.
	// Therefore call the instruction as AddressMode, and put a dummy function for Instruction.
	SetAddressingMode(BRK, [ 0x00 ]);
	SetInstruction(function() {}, [ 0x00 ]);

	for (var i = 0; i < 256; i++)
		if (!Opcodes[i].Instruction) Opcodes[i] = null;

	// For transferring data between addressing step and instruction step. TODO: refactor.
	var TempM;
	var TempAddress;

	// Implied addressing mode.
	// e.g., TAX
	function Implied()
	{
		TempM = 0;
		TempAddress = 0;
		++PC;
	}

	// Immediate addressing mode.
	// e.g., LDA #10
	function Immediate()
	{
		TempM = ReadByte(PC + 1);
		TempAddress = 0;
		PC += 2;
	}

	// Absolute addressing mode //(read): $AD LDA / $AE LDX / $AC LDY / $4D EOR / $2D AND / $0D ORA / $6D ADC / $ED SBC / $CD CMP / $EC CPX / $CC CPY / $2C BIT.
	// e.g., LDA $2002
	function Absolute()
	{
		var Low = ReadByte(PC + 1);
		var High = ReadByte(PC + 2);
		TempAddress = (High << 8) | Low;
		PC += 3;
	}

	// Absolute X-indexed addressing mode.
	// e.g., LDA $3000,X
	function AbsoluteX()
	{
		var Low = ReadByte(PC + 1);
		var High = ReadByte(PC + 2);
		var EffectiveAddress = (High << 8) | Low;
		TempAddress = (EffectiveAddress + X) & 0xFFFF;
		PC += 3;
	}

	// Absolute Y-indexed addressing mode.
	// e.g., LDA $3000,Y
	function AbsoluteY()
	{
		var Low = ReadByte(PC + 1);
		var High = ReadByte(PC + 2);
		var EffectiveAddress = (High << 8) | Low;
		TempAddress = (EffectiveAddress + Y) & 0xFFFF;
		PC += 3;
	}

	// Read/write operations with indexed absolute addressing have an anomalous extra cycle.
	function AbsoluteX_RW() { AbsoluteX(); } // CycleCounter = 4;
	function AbsoluteY_RW() { AbsoluteY(); } // CycleCounter = 4;

	// Zero-page addressing mode.
	// e.g., LDA $10
	function ZeroPage()
	{
		TempAddress = ReadByte(PC + 1);
		PC += 2;
	}

	// Zero-page X-indexed addressing mode.
	// e.g., LDA $10,X
	function ZeroPageX()
	{
		TempAddress = (ReadByte(PC + 1) + X) & 0xFF;
		PC += 2;
	}

	// Zero-page Y-indexed addressing mode.
	// e.g., LDA $10,Y
	function ZeroPageY()
	{
		TempAddress = (ReadByte(PC + 1) + Y) & 0xFF;
		PC += 2;
	}

	// Indexed indirect addressing mode.
	// e.g., LDA ($40,X)
	function IndexedIndirect()
	{
		var ZeroPageIndex = ReadByte(PC + 1);
		var Low = ReadByte((ZeroPageIndex + X) & 0xFF);
		var High = ReadByte((ZeroPageIndex + X + 1) & 0xFF);
		TempAddress = (High << 8) | Low;
		PC += 2;
	}

	// Indirect indexed addressing mode.
	// e.g., LDA ($40),Y
	function IndirectIndexed()
	{
		var ZeroPageIndex = ReadByte(PC + 1);
		var Low = ReadByte(ZeroPageIndex);
		var High = ReadByte((ZeroPageIndex + 1) & 0xFF);
		var EffectiveAddress = (High << 8) | Low;
		TempAddress = (EffectiveAddress + Y) & 0xFFFF;
		PC += 2;
	}

	function IndirectIndexed_RW() { IndirectIndexed(); } // CycleCounter = 5;

	// Relative addressing mode.
	// e.g., BEQ $A7
	function Relative()
	{
		var Relative = ReadByte(PC + 1); // The relative displacement is signed, often negative.
		if (Relative > 127) Relative = -0x100 + Relative; // TODO: check this is right.
		PC += 2;
		TempAddress = PC + Relative;
		TempM = 0;
	}

	// Indirect addressing mode.
	// e.g., JMP ($FFFC)
	function Indirect()
	{
		var Low = ReadByte(PC + 1);
		var High = ReadByte(PC + 2);
		var EffectiveAddress = (High << 8) | Low;
		var NewLow = ReadByte(EffectiveAddress);
		var NewHigh = ReadByte((High << 8) | ((Low + 1) & 0xFF)); // Note that this conforms to 6502 bug about page boundary.
		TempAddress = (NewHigh << 8) | NewLow;
		TempM = 0;
		PC += 3;
	}












	function ADC()
	{
		var Result = A + TempM + (Carry ? 1 : 0);
		Zero = (Result & 0xFF) == 0;
		Carry = (Result >> 8) != 0;
		Negative = (Result & 0x80) != 0;
		// Overflow bit is set when:
		// 1. A negative, M negative, but A + M + C does not have negative bit set (e.g. A = -64, M = -65).
		// 2. A positive, M positive, but A + M + C has negative bit set (e.g. A = M = 64).
		// (A ^ M) & 0x80 is zero when A and M have the same sign.
		Overflow = (((A ^ TempM) & 0x80) == 0) && (((A ^ Result) & 0x80) != 0);
		A = (Result & 0xFF);
	}

	function AND()
	{
		A &= TempM;
		Zero = (A == 0);
		Negative = (A & 0x80) != 0;
	}

	function ASL()
	{
		Carry = (TempM & 0x80) != 0;
		TempM <<= 1;
		TempM &= 0xFF;
		WriteByte(TempAddress, TempM);
		Zero = (TempM == 0);
		Negative = (TempM & 0x80) != 0;
	}

	function ASL_A()
	{
		Carry = (A & 0x80) != 0;
		A <<= 1;
		A &= 0xFF;
		Zero = (A == 0);
		Negative = (A & 0x80) != 0;
	}

	function GenericBranch(TakeBranch)
	{
		var CrossedPage = ((PC & 0xFF00) != (TempAddress & 0xFF00));

		if (TakeBranch)
		{
			PC = TempAddress;
			//if (!CrossedPage) CycleCounter = 1; // Branch succeeded but didn't cross page.
			//else CycleCounter = 2; // Branch succeded and crossed page.
		}
	}

	function BCC() { GenericBranch(!Carry); }
	function BCS() { GenericBranch(Carry); }
	function BEQ() { GenericBranch(Zero); }

	function BIT()
	{
		Zero = (A & TempM) == 0;
		Negative = (TempM & 0x80) != 0;
		Overflow = (TempM & 0x40) != 0;
	}

	function BMI() { GenericBranch(Negative); }
	function BNE() { GenericBranch(!Zero); }
	function BPL() { GenericBranch(!Negative); }

	function BRK()
	{
		Break = true;
		RaiseInterrupt(NES.InterruptType.IRQBRK);
		//CycleCounter = 7;
		PC += 2;
	}

	function BVC() { GenericBranch(!Overflow); }
	function BVS() { GenericBranch(Overflow); }

	function CLC() { Carry = false; }
	function CLD() { DecimalMode = false; }
	function CLI() { IRQDisable = false; }
	function CLV() { Overflow = false; }

	function CMP()
	{
		var Result = A - TempM;
		Zero = (Result == 0);
		Carry = (Result >= 0);
		Negative = (Result & 0x80) != 0;
	}

	function CPX()
	{
		var Result = X - TempM;
		Zero = (Result == 0);
		Carry = (Result >= 0);
		Negative = (Result & 0x80) != 0;
	}

	function CPY()
	{
		var Result = Y - TempM;
		Zero = (Result == 0);
		Carry = (Result >= 0);
		Negative = (Result & 0x80) != 0;
	}

	function DEC()
	{
		--TempM;
		WriteByte(TempAddress, TempM);
		Zero = (TempM == 0);
		Negative = (TempM & 0x80) != 0;
	}

	function DEX()
	{
		--X;
		X &= 0xFF;
		Zero = (X == 0);
		Negative = (X & 0x80) != 0;
	}

	function DEY()
	{
		--Y;
		Y &= 0xFF;
		Zero = (Y == 0);
		Negative = (Y & 0x80) != 0;
	}

	function EOR()
	{
		A ^= TempM;
		Zero = (A == 0);
		Negative = (A & 0x80) != 0;
	}

	function INC()
	{
		++TempM;
		WriteByte(TempAddress, TempM);
		Zero = (TempM == 0);
		Negative = (TempM & 0x80) != 0;
	}

	function INX()
	{
		++X;
		X &= 0xFF;
		Zero = (X == 0);
		Negative = (X & 0x80) != 0;
	}

	function INY()
	{
		++Y;
		Y &= 0xFF;
		Zero = (Y == 0);
		Negative = (Y & 0x80) != 0;
	}

	function JMP() { PC = TempAddress; }

	function JSR()
	{
		// Push the return address onto the stack, high byte first. JSR is three bytes long.
		// Return address is (PC + 3) - 1, and the addressing code already pushed us forward three bytes.
		var ReturnPoint = (PC - 1) & 0xFFFF;
		PushStack(ReturnPoint >> 8);
		PushStack(ReturnPoint);
		PC = TempAddress;
	}

	function LDA()
	{
		A = TempM;
		Zero = (A == 0);
		Negative = (A & 0x80) != 0;
	}

	function LDX()
	{
		X = TempM;
		Zero = (X == 0);
		Negative = (X & 0x80) != 0;
	}

	function LDY()
	{
		Y = TempM;
		Zero = (Y == 0);
		Negative = (Y & 0x80) != 0;
	}

	function LSR()
	{
		Carry = (TempM & 0x01) != 0;
		TempM >>= 1;
		Zero = (TempM == 0);
		Negative = false;
		WriteByte(TempAddress, TempM);
	}

	function LSR_A()
	{
		Carry = (A & 0x01) != 0;
		A >>= 1;
		Zero = (A == 0);
		Negative = false;
	}

	function NOP() { }

	function ORA()
	{
		A |= TempM;
		Zero = (A == 0);
		Negative = (A & 0x80) != 0;
	}

	function PHA()
	{
		PushStack(A);
	}

	function PHP()
	{
		// PHP always pushes the break flag.
		PushStack(StatusRegister() | 0x10);
	}

	function PLA()
	{
		A = PopStack();
		Zero = (A == 0);
		Negative = (A & 0x80) != 0;
	}

	function PLP()
	{
		// Retrieve the status register.
		var Status = PopStack();
		Carry = (Status & 0x01) != 0;
		Zero = (Status & 0x02) != 0;
		IRQDisable = (Status & 0x04) != 0;
		DecimalMode = (Status & 0x08) != 0;
		Overflow = (Status & 0x40) != 0;
		Negative = (Status & 0x80) != 0;
		// Break is ignored when Status is popped. See NinTech.txt line 192.
	}

	function ROL()
	{
		var M = TempM; // TODO: relying on extra bits here. Re-do.
		M <<= 1;
		if (Carry) ++M;
		Carry = (M & 0x100) != 0;
		M &= 0xFF;
		Zero = (M == 0);
		Negative = (M & 0x80) != 0;
		WriteByte(TempAddress, M);
	}

	function ROL_A()
	{
		A <<= 1;
		if (Carry) ++A;
		Carry = (A & 0x100) != 0;
		A &= 0xFF;
		Zero = (A == 0);
		Negative = (A & 0x80) != 0;
	}

	function ROR()
	{
		var M = TempM; // TODO: relying on extra bits here. Re-do.
		var WasCarry = Carry;
		Carry = (M & 1) != 0;
		M >>= 1;
		if (WasCarry) M |= 0x80;
		Zero = (M == 0);
		Negative = (M & 0x80) != 0;
		WriteByte(TempAddress, M);
	}

	function ROR_A()
	{
		var WasCarry = Carry;
		Carry = (A & 1) != 0;
		A >>= 1;
		if (WasCarry) A |= 0x80;
		Zero = (A == 0);
		Negative = (A & 0x80) != 0;
	}

	function RTI()
	{
		// Retrieve the status register.
		var Status = PopStack();
		Carry = (Status & 0x01) != 0;
		Zero = (Status & 0x02) != 0;
		IRQDisable = (Status & 0x04) != 0;
		DecimalMode = (Status & 0x08) != 0;
		Overflow = (Status & 0x40) != 0;
		Negative = (Status & 0x80) != 0;
		// Break flag is ignored when Status is popped. See NinTech.txt line 192.

		// Retrieve the program counter, low byte first.
		var Low = PopStack();
		var High = PopStack();
		PC = (High << 8) | Low;
	}

	function RTS()
	{
		// Pop the return address off the stack, low byte first.
		var Low = PopStack();
		var High = PopStack();
		PC = ((High << 8) | Low) + 1;
	}

	function SBC()
	{
		var Result = A - TempM - (Carry ? 0 : 1);
		Zero = (Result & 0xFF) == 0;
		Carry = (Result >> 8) == 0;
		Negative = (Result & 0x80) != 0;
		// Overflow bit is set when:
		// 1. A negative, M positive, but A - M - (1 - C) positive, i.e. does not have negative bit set (e.g. C = 1, A = -64, M = 65).
		// 2. A positive, M negative, but A - M - (1 - C) is negative, i.e. has negative bit set (e.g. C = 1, A = 64, M = -64).
		// (A ^ M) & 0x80 is zero when A and M have the same sign.
		// Note that this logic is not the same as for ADC.
		Overflow = (((A ^ TempM) & 0x80) != 0) && (((A ^ Result) & 0x80) != 0);
		A = (Result & 0xFF);
	}

	function SEC() { Carry = true; }
	function SED() { DecimalMode = true; }
	function SEI() { IRQDisable = true; }

	function STA() { WriteByte(TempAddress, A); }
	function STX() { WriteByte(TempAddress, X); }
	function STY() { WriteByte(TempAddress, Y); }

	function TAX()
	{
		X = A;
		Zero = (X == 0);
		Negative = (X & 0x80) != 0;
	}

	function TAY()
	{
		Y = A;
		Zero = (Y == 0);
		Negative = (Y & 0x80) != 0;
	}

	function TSX()
	{
		X = S;
		Zero = (X == 0);
		Negative = (X & 0x80) != 0;
	}

	function TXA()
	{
		A = X;
		Zero = (A == 0);
		Negative = (A & 0x80) != 0;
	}

	function TXS() { S = X; }

	function TYA()
	{
		A = Y;
		Zero = (A == 0);
		Negative = (A & 0x80) != 0;
	}
}
